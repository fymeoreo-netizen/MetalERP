begin;

drop function if exists erp.complete_researcher_account(uuid, uuid, text);

create function erp.complete_researcher_account(
  p_reservation_id uuid,
  p_user_id uuid,
  p_email text,
  p_role_code text
) returns void
language plpgsql
security definer
set search_path = erp, public, pg_temp
as $$
declare
  v_email text;
  v_role_code text;
  v_role_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  v_role_code := upper(trim(coalesce(p_role_code, '')));
  if v_role_code not in ('ADMIN', 'ACCOUNTANT') then
    raise exception 'invalid_researcher_role' using errcode = '22023';
  end if;

  select email into v_email
  from erp.researcher_account_provisions
  where id = p_reservation_id
    and user_id is null
  for update;

  if v_email is null or v_email <> lower(trim(p_email)) then
    raise exception 'invalid_researcher_account_reservation' using errcode = '22023';
  end if;

  select id into v_role_id
  from erp.roles
  where code = v_role_code
  limit 1;

  if v_role_id is null then
    raise exception 'researcher_role_missing';
  end if;

  insert into erp.user_profiles (user_id, display_name, email, is_active)
  values (
    p_user_id,
    case when v_role_code = 'ADMIN' then 'Security Researcher (Admin)' else 'Security Researcher (Accountant)' end,
    v_email,
    true
  )
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    email = excluded.email,
    is_active = true;

  insert into erp.user_role_assignments (user_id, role_id)
  values (p_user_id, v_role_id)
  on conflict (user_id, role_id) do nothing;

  update erp.researcher_account_provisions
  set user_id = p_user_id,
      completed_at = now()
  where id = p_reservation_id;
end;
$$;

revoke all on function erp.complete_researcher_account(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function erp.complete_researcher_account(uuid, uuid, text, text)
  to service_role;

commit;

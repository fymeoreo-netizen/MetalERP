begin;

create or replace function erp.reserve_researcher_account(
  p_requester_hash text,
  p_email text
) returns uuid
language plpgsql
security definer
set search_path = erp, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_requester_hash, ''))) < 32
     or length(trim(coalesce(p_email, ''))) < 6 then
    raise exception 'invalid_researcher_account_request' using errcode = '22023';
  end if;

  delete from erp.researcher_account_provisions
  where user_id is null
    and created_at < now() - interval '10 minutes';

  if (
    select count(*)
    from erp.researcher_account_provisions rap
    left join erp.user_profiles up on up.user_id = rap.user_id
    where rap.requester_hash = p_requester_hash
      and rap.created_at >= now() - interval '1 hour'
      and (rap.user_id is null or up.is_active = true)
  ) >= 5 then
    raise exception 'researcher_account_rate_limited' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from erp.researcher_account_provisions rap
    left join erp.user_profiles up on up.user_id = rap.user_id
    where rap.created_at >= now() - interval '24 hours'
      and (rap.user_id is null or up.is_active = true)
  ) >= 100 then
    raise exception 'researcher_account_capacity_reached' using errcode = 'P0001';
  end if;

  insert into erp.researcher_account_provisions (email, requester_hash)
  values (lower(trim(p_email)), p_requester_hash)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function erp.reserve_researcher_account(text, text)
  from public, anon, authenticated;
grant execute on function erp.reserve_researcher_account(text, text)
  to service_role;

commit;

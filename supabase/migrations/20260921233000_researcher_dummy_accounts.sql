begin;

create table if not exists erp.researcher_account_provisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  email text not null unique,
  requester_hash text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_researcher_account_provisions_requester_created
  on erp.researcher_account_provisions (requester_hash, created_at desc);

alter table erp.researcher_account_provisions enable row level security;

revoke all on table erp.researcher_account_provisions from public, anon, authenticated;
grant select, insert, update, delete on table erp.researcher_account_provisions to service_role;

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
    from erp.researcher_account_provisions
    where requester_hash = p_requester_hash
      and created_at >= now() - interval '1 hour'
  ) >= 3 then
    raise exception 'researcher_account_rate_limited' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from erp.researcher_account_provisions
    where created_at >= now() - interval '24 hours'
  ) >= 100 then
    raise exception 'researcher_account_capacity_reached' using errcode = 'P0001';
  end if;

  insert into erp.researcher_account_provisions (email, requester_hash)
  values (lower(trim(p_email)), p_requester_hash)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function erp.complete_researcher_account(
  p_reservation_id uuid,
  p_user_id uuid,
  p_email text
) returns void
language plpgsql
security definer
set search_path = erp, public, pg_temp
as $$
declare
  v_email text;
  v_role_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
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
  where code = 'ACCOUNTANT'
  limit 1;

  if v_role_id is null then
    raise exception 'accountant_role_missing';
  end if;

  insert into erp.user_profiles (user_id, display_name, email, is_active)
  values (p_user_id, 'Security Researcher', v_email, true)
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

create or replace function erp.cancel_researcher_account_reservation(
  p_reservation_id uuid
) returns void
language plpgsql
security definer
set search_path = erp, public, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  delete from erp.researcher_account_provisions
  where id = p_reservation_id
    and user_id is null;
end;
$$;

revoke all on function erp.reserve_researcher_account(text, text) from public, anon, authenticated;
revoke all on function erp.complete_researcher_account(uuid, uuid, text) from public, anon, authenticated;
revoke all on function erp.cancel_researcher_account_reservation(uuid) from public, anon, authenticated;

grant execute on function erp.reserve_researcher_account(text, text) to service_role;
grant execute on function erp.complete_researcher_account(uuid, uuid, text) to service_role;
grant execute on function erp.cancel_researcher_account_reservation(uuid) to service_role;

commit;

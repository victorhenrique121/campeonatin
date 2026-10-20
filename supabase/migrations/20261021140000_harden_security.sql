-- Beta hardening: anonymous clients must not access domain data directly.
revoke all privileges on table
  public.profiles,
  public.players,
  public.teams,
  public.championships,
  public.matches,
  public.fixtures,
  public.championship_participants,
  public.rooms,
  public.room_members,
  public.teams2v2,
  public.knockout_byes,
  public.friends,
  public.blocked_users,
  public.notifications
from anon;

-- Identity sequences are also domain data access points. Keep them unavailable
-- to anonymous clients without changing authenticated/service permissions.
revoke all privileges on all sequences in schema public from anon;

-- Enforce the maximum of three active rooms owned by one user in the database.
-- The advisory lock serializes concurrent attempts made by the same owner.
create or replace function public.enforce_room_owner_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_owner_rooms integer;
begin
  if new.role <> 'owner'
    or (tg_op = 'UPDATE' and old.role = 'owner') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 0)
  );

  select count(*)
    into v_active_owner_rooms
  from public.room_members as member
  join public.rooms as room on room.id = member.room_id
  where member.user_id = new.user_id
    and member.role = 'owner'
    and room.deleted_at is null;

  if v_active_owner_rooms >= 3 then
    raise exception 'Você já atingiu o limite de 3 salas como proprietário. Exclua uma sala antiga para criar outra.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_room_owner_limit() from public, anon, authenticated;

drop trigger if exists room_members_owner_limit on public.room_members;
create trigger room_members_owner_limit
before insert or update of role on public.room_members
for each row execute function public.enforce_room_owner_limit();

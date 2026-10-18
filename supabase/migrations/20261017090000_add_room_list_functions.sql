create or replace function public.list_room_members(p_room_id uuid)
returns table(role public.room_member_role, display_name text, username text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select rm.role, p.display_name, p.username, p.avatar_url
  from public.room_members rm
  join public.profiles p on p.id = rm.user_id
  where rm.room_id = p_room_id and public.is_room_member(p_room_id)
  order by rm.role, p.display_name;
$$;

create or replace function public.list_my_rooms()
returns table(id uuid, name text, role public.room_member_role, entry_code text, member_count bigint)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, rm.role, r.entry_code,
    (select count(*) from public.room_members members where members.room_id = r.id)
  from public.rooms r
  join public.room_members rm on rm.room_id = r.id
  where rm.user_id = auth.uid() and r.deleted_at is null
  order by r.name;
$$;

revoke all on function public.list_room_members(uuid) from public, anon;
revoke all on function public.list_my_rooms() from public, anon;
grant execute on function public.list_room_members(uuid), public.list_my_rooms() to authenticated;

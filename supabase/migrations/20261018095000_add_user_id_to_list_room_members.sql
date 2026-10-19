begin;

drop function if exists public.list_room_members(uuid);

create function public.list_room_members(p_room_id uuid)
returns table(user_id uuid, role public.room_member_role, display_name text, username text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select rm.user_id, rm.role, p.display_name, p.username, p.avatar_url
  from public.room_members rm
  join public.profiles p on p.id = rm.user_id
  where rm.room_id = p_room_id and public.is_room_member(p_room_id)
  order by rm.role, p.display_name;
$$;

revoke all on function public.list_room_members(uuid) from public, anon;
grant execute on function public.list_room_members(uuid) to authenticated;

commit;

create or replace function public.delete_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.room_member_role(p_room_id) is null or public.room_member_role(p_room_id) <> 'owner' then
    raise exception 'Sem permissão para excluir a sala.';
  end if;

  update public.rooms
  set deleted_at = now(), updated_at = now()
  where id = p_room_id and deleted_at is null;

  if not found then
    raise exception 'Sem permissão para excluir a sala.';
  end if;
end;
$$;

revoke all on function public.delete_room(uuid) from public, anon;
grant execute on function public.delete_room(uuid) to authenticated;

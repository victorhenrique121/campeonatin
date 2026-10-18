create or replace function public.promote_room_admin(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target_role public.room_member_role;
begin
  if public.room_member_role(p_room_id) is null or public.room_member_role(p_room_id) <> 'owner' then
    raise exception 'Sem permissão para promover administrador.';
  end if;

  select rm.role into v_target_role
  from public.room_members rm
  where rm.room_id = p_room_id and rm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Usuário não é membro da sala.';
  end if;

  if v_target_role = 'admin' then
    raise exception 'Usuário já é administrador.';
  end if;

  if v_target_role = 'owner' then
    raise exception 'Não é possível promover o proprietário.';
  end if;

  update public.room_members
  set role = 'admin'
  where room_id = p_room_id and user_id = p_user_id;

  if not found then
    raise exception 'Usuário não é membro da sala.';
  end if;
end;
$$;

revoke all on function public.promote_room_admin(uuid, uuid) from public, anon;
grant execute on function public.promote_room_admin(uuid, uuid) to authenticated;

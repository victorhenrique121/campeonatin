create or replace function public.remove_room_member(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target_role public.room_member_role;
begin
  if public.room_member_role(p_room_id) is null or public.room_member_role(p_room_id) <> 'owner' then
    raise exception 'Sem permissão para remover membro.';
  end if;

  select rm.role into v_target_role
  from public.room_members rm
  where rm.room_id = p_room_id and rm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Usuário não é membro da sala.';
  end if;

  if v_target_role = 'owner' then
    raise exception 'O proprietário não pode ser removido; transfira a propriedade antes.';
  end if;

  delete from public.room_members
  where room_id = p_room_id and user_id = p_user_id;

  if not found then
    raise exception 'Usuário não é membro da sala.';
  end if;
end;
$$;

revoke all on function public.remove_room_member(uuid, uuid) from public, anon;
grant execute on function public.remove_room_member(uuid, uuid) to authenticated;

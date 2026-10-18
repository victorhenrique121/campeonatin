create or replace function public.transfer_room_ownership(p_room_id uuid, p_new_owner_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.room_member_role(p_room_id) is null or public.room_member_role(p_room_id) <> 'owner' then
    raise exception 'Sem permissão para transferir a propriedade.';
  end if;

  perform 1 from public.rooms where id = p_room_id and deleted_at is null for update;

  if not found or public.room_member_role(p_room_id) is null or public.room_member_role(p_room_id) <> 'owner' then
    raise exception 'Sem permissão para transferir a propriedade.';
  end if;

  perform 1 from public.room_members
  where room_id = p_room_id and user_id = auth.uid() and role = 'owner'
  for update;

  if not found then
    raise exception 'Não foi possível transferir a propriedade; tente novamente.';
  end if;

  perform 1 from public.room_members
  where room_id = p_room_id and user_id = p_new_owner_id
  for update;

  if not found then
    raise exception 'Usuário não é membro da sala.';
  end if;

  if p_new_owner_id = auth.uid() then
    raise exception 'O usuário já é o proprietário.';
  end if;

  update public.room_members
  set role = 'admin'
  where room_id = p_room_id and user_id = auth.uid() and role = 'owner';

  if not found then
    raise exception 'Não foi possível transferir a propriedade; tente novamente.';
  end if;

  update public.room_members
  set role = 'owner'
  where room_id = p_room_id and user_id = p_new_owner_id;

  if not found then
    raise exception 'Não foi possível transferir a propriedade; tente novamente.';
  end if;
end;
$$;

revoke all on function public.transfer_room_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_room_ownership(uuid, uuid) to authenticated;

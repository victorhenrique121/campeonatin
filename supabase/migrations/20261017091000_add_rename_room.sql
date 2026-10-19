create or replace function public.rename_room(p_room_id uuid, p_name text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.room_member_role(p_room_id) is null or public.room_member_role(p_room_id) <> 'owner' then
    raise exception 'Sem permissão para renomear a sala.';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'O nome da sala não pode ser vazio.';
  end if;

  if char_length(p_name) > 60 then
    raise exception 'O nome da sala é longo demais.';
  end if;

  update public.rooms
  set name = trim(p_name), updated_at = now()
  where id = p_room_id and deleted_at is null;

  if not found then
    raise exception 'Sem permissão para renomear a sala.';
  end if;
end;
$$;

revoke all on function public.rename_room(uuid, text) from public, anon;
grant execute on function public.rename_room(uuid, text) to authenticated;

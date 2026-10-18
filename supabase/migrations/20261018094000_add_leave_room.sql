create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.room_member_role;
  v_member_count bigint;
  v_new_owner uuid;
begin
  if public.room_member_role(p_room_id) is null then
    raise exception 'Você não é membro desta sala.';
  end if;

  perform 1 from public.rooms where id = p_room_id and deleted_at is null for update;

  if not found then
    raise exception 'Você não é membro desta sala.';
  end if;

  v_role := public.room_member_role(p_room_id);
  if v_role is null then
    raise exception 'Você não é membro desta sala.';
  end if;

  if v_role in ('participant', 'admin') then
    delete from public.room_members
    where room_id = p_room_id and user_id = auth.uid();

    if not found then
      raise exception 'Você não é membro desta sala.';
    end if;
    return;
  end if;

  select count(*) into v_member_count
  from public.room_members where room_id = p_room_id;

  if v_member_count = 1 then
    raise exception 'A sala ficaria sem proprietário; exclua a sala ou transfira a propriedade antes de sair.';
  end if;

  select user_id into v_new_owner
  from public.room_members
  where room_id = p_room_id and role = 'admin'
  order by created_at asc, user_id asc
  limit 1 for update;

  if v_new_owner is null then
    select user_id into v_new_owner
    from public.room_members
    where room_id = p_room_id and role = 'participant'
    order by created_at asc, user_id asc
    limit 1 for update;
  end if;

  if v_new_owner is null then
    raise exception 'Não foi possível transferir a propriedade; tente novamente.';
  end if;

  update public.room_members
  set role = 'admin'
  where room_id = p_room_id and user_id = auth.uid() and role = 'owner';

  if not found then
    raise exception 'Não foi possível transferir a propriedade; tente novamente.';
  end if;

  update public.room_members
  set role = 'owner'
  where room_id = p_room_id and user_id = v_new_owner;

  if not found then
    raise exception 'Não foi possível transferir a propriedade; tente novamente.';
  end if;

  delete from public.room_members
  where room_id = p_room_id and user_id = auth.uid() and role = 'admin';

  if not found then
    raise exception 'Não foi possível transferir a propriedade; tente novamente.';
  end if;
end;
$$;

revoke all on function public.leave_room(uuid) from public, anon;
grant execute on function public.leave_room(uuid) to authenticated;

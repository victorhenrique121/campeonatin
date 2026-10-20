-- FC Arena: dados necessários para aceitar e apresentar convites de sala.

create or replace function public.send_room_invite(
  p_recipient_id uuid,
  p_room_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := auth.uid();
  v_sender_name text;
  v_room_name text;
  v_room_code text;
begin
  if v_sender_id is null then
    raise exception 'Sua sessão expirou. Entre novamente para continuar.';
  end if;

  if v_sender_id = p_recipient_id then
    raise exception 'Você não pode convidar a si mesmo.';
  end if;

  select p.display_name
  into v_sender_name
  from public.profiles as p
  where p.id = v_sender_id;

  select r.name, r.entry_code
  into v_room_name, v_room_code
  from public.rooms as r
  join public.room_members as rm on rm.room_id = r.id
  where r.id = p_room_id
    and rm.user_id = v_sender_id
    and rm.role in ('owner', 'admin')
    and r.deleted_at is null;

  if not found then
    raise exception 'Você não tem permissão para convidar pessoas para esta sala.';
  end if;

  if not exists (
    select 1
    from public.friends as f
    where f.user_id = v_sender_id
      and f.friend_id = p_recipient_id
  ) then
    raise exception 'Você só pode convidar pessoas da sua lista de amigos.';
  end if;

  if exists (
    select 1
    from public.blocked_users as b
    where (b.user_id = v_sender_id and b.blocked_id = p_recipient_id)
       or (b.user_id = p_recipient_id and b.blocked_id = v_sender_id)
  ) then
    raise exception 'Não é possível enviar convite para este usuário.';
  end if;

  if exists (
    select 1
    from public.room_members as rm
    where rm.room_id = p_room_id
      and rm.user_id = p_recipient_id
  ) then
    raise exception 'Este amigo já participa da sala.';
  end if;

  insert into public.notifications (user_id, sender_id, type, payload)
  values (
    p_recipient_id,
    v_sender_id,
    'room_invite',
    jsonb_build_object(
      'roomId', p_room_id,
      'roomCode', v_room_code,
      'roomName', v_room_name,
      'senderName', v_sender_name
    )
  );
end;
$$;

revoke all on function public.send_room_invite(uuid, uuid) from public, anon;
grant execute on function public.send_room_invite(uuid, uuid) to authenticated;

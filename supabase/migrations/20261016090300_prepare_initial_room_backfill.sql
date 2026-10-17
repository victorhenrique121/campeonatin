-- Esta migration apenas cria a função. O backfill só acontece quando um administrador
-- do projeto a chamar explicitamente com o nome da sala e o UUID do dono.
create or replace function public.backfill_initial_room(p_name text, p_owner_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room_id uuid; v_code text; v_try integer;
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Nome da sala inválido.'; end if;
  if not exists (select 1 from public.profiles where id = p_owner_id) then raise exception 'Dono da sala inválido.'; end if;
  if exists (select 1 from public.players where room_id is not null)
     or exists (select 1 from public.championships where room_id is not null)
     or exists (select 1 from public.matches where room_id is not null)
     or exists (select 1 from public.fixtures where room_id is not null)
     or exists (select 1 from public.championship_participants where room_id is not null) then
    raise exception 'O backfill inicial já foi executado ou há dados atribuídos a salas.';
  end if;
  for v_try in 1..10 loop
    v_code := public.room_entry_code();
    begin
      insert into public.rooms(name, entry_code, created_by) values (trim(p_name), v_code, p_owner_id) returning id into v_room_id;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  if v_room_id is null then raise exception 'Não foi possível criar a sala inicial. Tente novamente.'; end if;
  insert into public.room_members(room_id, user_id, role) values (v_room_id, p_owner_id, 'owner');
  update public.players set room_id = v_room_id, created_by = p_owner_id where room_id is null;
  update public.championships set room_id = v_room_id, created_by = p_owner_id where room_id is null;
  update public.matches set room_id = v_room_id, created_by = p_owner_id where room_id is null;
  update public.fixtures set room_id = v_room_id, created_by = p_owner_id where room_id is null;
  update public.championship_participants set room_id = v_room_id, created_by = p_owner_id where room_id is null;
  return v_room_id;
end; $$;

revoke all on function public.backfill_initial_room(text, uuid) from public, anon, authenticated;

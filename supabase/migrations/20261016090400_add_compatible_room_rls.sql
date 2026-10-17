-- Políticas por sala compatíveis com o app atual e dados legados sem room_id.
-- Políticas restritivas são combinadas com AND; cada comando precisa da sua.

-- players
create policy players_room_select_gate on public.players as restrictive for select to authenticated using (room_id is null or public.current_user_role() = 'admin' or (select public.is_room_member(room_id)));
create policy players_room_insert_gate on public.players as restrictive for insert to authenticated with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy players_room_update_gate on public.players as restrictive for update to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy players_room_delete_gate on public.players as restrictive for delete to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy players_room_organizer_insert on public.players for insert to authenticated with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy players_room_organizer_update on public.players for update to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy players_room_organizer_delete on public.players for delete to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));

-- championships
create policy championships_room_select_gate on public.championships as restrictive for select to authenticated using (room_id is null or public.current_user_role() = 'admin' or (select public.is_room_member(room_id)));
create policy championships_room_insert_gate on public.championships as restrictive for insert to authenticated with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy championships_room_update_gate on public.championships as restrictive for update to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy championships_room_delete_gate on public.championships as restrictive for delete to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy championships_room_organizer_insert on public.championships for insert to authenticated with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy championships_room_organizer_update on public.championships for update to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy championships_room_organizer_delete on public.championships for delete to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));

-- matches
create policy matches_room_select_gate on public.matches as restrictive for select to authenticated using (room_id is null or public.current_user_role() = 'admin' or (select public.is_room_member(room_id)));
create policy matches_room_insert_gate on public.matches as restrictive for insert to authenticated with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy matches_room_update_gate on public.matches as restrictive for update to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy matches_room_delete_gate on public.matches as restrictive for delete to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy matches_room_organizer_insert on public.matches for insert to authenticated with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy matches_room_organizer_update on public.matches for update to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy matches_room_organizer_delete on public.matches for delete to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));

-- fixtures
create policy fixtures_room_select_gate on public.fixtures as restrictive for select to authenticated using (room_id is null or public.current_user_role() = 'admin' or (select public.is_room_member(room_id)));
create policy fixtures_room_insert_gate on public.fixtures as restrictive for insert to authenticated with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy fixtures_room_update_gate on public.fixtures as restrictive for update to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy fixtures_room_delete_gate on public.fixtures as restrictive for delete to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy fixtures_room_organizer_insert on public.fixtures for insert to authenticated with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy fixtures_room_organizer_update on public.fixtures for update to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy fixtures_room_organizer_delete on public.fixtures for delete to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));

-- championship_participants
create policy championship_participants_room_select_gate on public.championship_participants as restrictive for select to authenticated using (room_id is null or public.current_user_role() = 'admin' or (select public.is_room_member(room_id)));
create policy championship_participants_room_insert_gate on public.championship_participants as restrictive for insert to authenticated with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy championship_participants_room_update_gate on public.championship_participants as restrictive for update to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy championship_participants_room_delete_gate on public.championship_participants as restrictive for delete to authenticated using (room_id is null or public.current_user_role() = 'admin' or public.room_member_role(room_id) in ('owner', 'admin'));
create policy championship_participants_room_organizer_insert on public.championship_participants for insert to authenticated with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy championship_participants_room_organizer_update on public.championship_participants for update to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin')) with check (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));
create policy championship_participants_room_organizer_delete on public.championship_participants for delete to authenticated using (room_id is not null and public.room_member_role(room_id) in ('owner', 'admin'));

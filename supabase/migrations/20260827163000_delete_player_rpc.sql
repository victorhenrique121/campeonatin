-- FC Arena: atomic player deletion.
-- A player deletion currently removes matches, fixtures, championship
-- participations, and finally the player inside one SQLite transaction.
-- Keep the same invariant in PostgreSQL: this is intentionally one RPC
-- because separate client calls could leave the database in an intermediate
-- state if the network fails after only some deletes have succeeded.

create or replace function public.delete_player(p_player_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_role := public.current_user_role();
  if v_role is distinct from 'admin' then
    raise exception 'Apenas administradores podem excluir jogadores.' using errcode = '42501';
  end if;

  if p_player_id is null then
    raise exception 'O ID do jogador é obrigatório.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'Jogador não encontrado.' using errcode = 'P0002';
  end if;

  -- Preserve the existing business order. FK actions also protect the
  -- operation, but explicit deletes keep the behavior deterministic.
  delete from public.matches
  where player1_id = p_player_id or player2_id = p_player_id;

  delete from public.fixtures
  where player1_id = p_player_id or player2_id = p_player_id;

  delete from public.championship_participants
  where player_id = p_player_id;

  delete from public.players
  where id = p_player_id;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Não foi possível excluir o jogador.' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_player(bigint) from public;
grant execute on function public.delete_player(bigint) to authenticated;

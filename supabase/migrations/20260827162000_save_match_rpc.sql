-- FC Arena: atomic match registration/update of its championship fixture.
-- This function intentionally performs the whole operation in PostgreSQL so a
-- network failure cannot leave matches and fixtures half-updated.

create or replace function public.save_match(
  p_player1_id bigint,
  p_player2_id bigint,
  p_team1_id bigint,
  p_team2_id bigint,
  p_score1 integer,
  p_score2 integer,
  p_championship_id bigint default null,
  p_played_at timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id bigint;
  v_fixture_id bigint;
  v_round integer;
  v_stage text;
  v_role public.user_role;
  v_player_id bigint;
  v_current_count integer;
  v_total_count integer;
  v_next_round integer;
  v_winner_count integer;
  v_winner_ids bigint[];
  v_index integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_role := public.current_user_role();
  if v_role is null then
    raise exception 'Perfil do usuário não encontrado.' using errcode = '42501';
  end if;

  if p_player1_id is null or p_player2_id is null
     or p_team1_id is null or p_team2_id is null then
    raise exception 'Selecione os dois jogadores e os dois times.' using errcode = '22023';
  end if;

  if p_player1_id = p_player2_id or p_team1_id = p_team2_id then
    raise exception 'Escolha jogadores e times diferentes.' using errcode = '22023';
  end if;

  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 then
    raise exception 'Os placares devem ser números inteiros maiores ou iguais a zero.' using errcode = '22023';
  end if;

  if v_role <> 'admin' then
    select p.id into v_player_id
    from public.players p
    where p.user_id = auth.uid()
      and (p.id = p_player1_id or p.id = p_player2_id)
    limit 1;

    if v_player_id is null then
      raise exception 'Jogadores só podem registrar resultados das próprias partidas.' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from public.players where id = p_player1_id)
     or not exists (select 1 from public.players where id = p_player2_id) then
    raise exception 'Um dos jogadores selecionados não existe.' using errcode = '23503';
  end if;

  if not exists (select 1 from public.teams where id = p_team1_id)
     or not exists (select 1 from public.teams where id = p_team2_id) then
    raise exception 'Um dos times selecionados não existe.' using errcode = '23503';
  end if;

  if p_championship_id is not null
     and not exists (select 1 from public.championships where id = p_championship_id) then
    raise exception 'O campeonato selecionado não existe.' using errcode = '23503';
  end if;

  -- Serialize all match writes for the same championship before inspecting
  -- fixtures. Without this lock, two clients could both observe a partially
  -- completed knockout round and both return before either one generates the
  -- next round. The advisory lock is transaction-scoped and therefore keeps
  -- the entire RPC atomic while allowing unrelated championships to proceed.
  if p_championship_id is not null then
    perform pg_advisory_xact_lock(p_championship_id);
  end if;

  if p_championship_id is not null then
    select f.id, f.round_number, f.stage
      into v_fixture_id, v_round, v_stage
    from public.fixtures f
    where f.championship_id = p_championship_id
      and f.match_id is null
      and ((f.player1_id = p_player1_id and f.player2_id = p_player2_id)
        or (f.player1_id = p_player2_id and f.player2_id = p_player1_id))
    order by f.id
    limit 1
    for update;

    if v_fixture_id is null then
      raise exception 'Este confronto não está pendente neste campeonato.' using errcode = '23514';
    end if;

    if v_stage <> 'league' and p_score1 = p_score2 then
      raise exception 'No mata-mata informe um vencedor; empates não são permitidos.' using errcode = '23514';
    end if;
  end if;

  insert into public.matches (
    player1_id,
    player2_id,
    team1_id,
    team2_id,
    score1,
    score2,
    championship_id,
    played_at,
    created_by
  ) values (
    p_player1_id,
    p_player2_id,
    p_team1_id,
    p_team2_id,
    p_score1,
    p_score2,
    p_championship_id,
    coalesce(p_played_at, now()),
    auth.uid()
  )
  returning id into v_match_id;

  if v_fixture_id is null then
    return v_match_id;
  end if;

  update public.fixtures
  set match_id = v_match_id
  where id = v_fixture_id;

  -- League fixtures stop here. Knockout fixtures advance only when every
  -- fixture in the completed round has a result and there is no draw.
  if v_stage = 'league' then
    return v_match_id;
  end if;

  select count(*)::integer
    into v_total_count
  from public.fixtures
  where championship_id = p_championship_id
    and round_number = v_round
    and stage <> 'league';

  select count(*)::integer
    into v_current_count
  from public.fixtures f
  where f.championship_id = p_championship_id
    and f.round_number = v_round
    and f.stage <> 'league'
    and f.match_id is not null;

  if v_current_count <> v_total_count then
    return v_match_id;
  end if;

  if exists (
    select 1
    from public.fixtures f
    join public.matches m on m.id = f.match_id
    where f.championship_id = p_championship_id
      and f.round_number = v_round
      and f.stage <> 'league'
      and m.score1 = m.score2
  ) then
    raise exception 'Partidas eliminatórias não podem terminar empatadas.' using errcode = '23514';
  end if;

  if v_total_count = 1 then
    update public.championships
    set status = 'finished'
    where id = p_championship_id;
    return v_match_id;
  end if;

  v_next_round := v_round + 1;

  if exists (
    select 1 from public.fixtures
    where championship_id = p_championship_id
      and round_number = v_next_round
  ) then
    return v_match_id;
  end if;

  v_winner_ids := array[]::bigint[];

  for v_player_id in
    select case when m.score1 > m.score2 then m.player1_id else m.player2_id end
    from public.fixtures f
    join public.matches m on m.id = f.match_id
    where f.championship_id = p_championship_id
      and f.round_number = v_round
      and f.stage <> 'league'
    order by f.id
  loop
    v_winner_ids := array_append(v_winner_ids, v_player_id);
  end loop;

  v_winner_count := coalesce(array_length(v_winner_ids, 1), 0);

  for v_index in 1..floor(v_winner_count / 2)::integer loop
    insert into public.fixtures (
      championship_id,
      round_number,
      stage,
      player1_id,
      player2_id
    ) values (
      p_championship_id,
      v_next_round,
      case v_winner_count
        when 2 then 'Final'
        when 4 then 'Semifinal'
        when 8 then 'Quartas de final'
        when 16 then 'Oitavas de final'
        when 32 then 'Dezesseis-avos'
        else 'Fase de ' || v_winner_count::text
      end,
      v_winner_ids[(v_index * 2) - 1],
      v_winner_ids[v_index * 2]
    );
  end loop;

  return v_match_id;
end;
$$;

revoke all on function public.save_match(bigint, bigint, bigint, bigint, integer, integer, bigint, timestamptz) from public;
grant execute on function public.save_match(bigint, bigint, bigint, bigint, integer, integer, bigint, timestamptz) to authenticated;

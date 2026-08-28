-- FC Arena: atomic championship creation and fixture generation.
-- The operation is deliberately kept inside PostgreSQL instead of being split
-- into client-side INSERT/INSERT/fixture calls. If the network fails between
-- those calls, a championship could otherwise exist without participants or
-- fixtures. A single RPC gives us one transaction: validation, championship,
-- participants, and all initial fixtures are committed together or rolled back.
--
-- Business rules preserved from the TypeScript implementation:
--   * league: round-robin fixtures; odd participant counts receive a bye.
--   * knockout: exactly 2, 4, 8, 16, or 32 participants, paired in input order.
--   * groups_knockout remains intentionally unsupported.

create or replace function public.save_championship(
  p_name text,
  p_format text,
  p_starts_at timestamptz,
  p_participant_ids bigint[]
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_championship_id bigint;
  v_participant_count integer;
  v_existing_count integer;
  v_rotation bigint[];
  v_size integer;
  v_round integer;
  v_index integer;
  v_home bigint;
  v_away bigint;
  v_last bigint;
  v_player1 bigint;
  v_player2 bigint;
  v_stage text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_role := public.current_user_role();
  if v_role is distinct from 'admin' then
    raise exception 'Apenas administradores podem criar campeonatos.' using errcode = '42501';
  end if;

  -- Validate every input before creating any row.
  if p_name is null or btrim(p_name) = '' then
    raise exception 'O nome do campeonato é obrigatório.' using errcode = '22023';
  end if;

  if p_format is null or p_format not in ('league', 'knockout') then
    if p_format = 'groups_knockout' then
      raise exception 'Grupos + mata-mata será disponibilizado na próxima etapa.' using errcode = '22023';
    end if;
    raise exception 'Formato de campeonato inválido.' using errcode = '22023';
  end if;

  if p_starts_at is null then
    raise exception 'A data de início é obrigatória.' using errcode = '22023';
  end if;

  v_participant_count := coalesce(cardinality(p_participant_ids), 0);
  if v_participant_count < 2 then
    raise exception 'Informe nome e pelo menos dois participantes.' using errcode = '22023';
  end if;

  -- A UNIQUE participant set is required. Duplicates would corrupt both the
  -- round-robin rotation and the knockout bracket.
  select count(*)::integer into v_existing_count
  from (
    select distinct value
    from unnest(p_participant_ids) as value
  ) unique_ids;

  if v_existing_count <> v_participant_count then
    raise exception 'A lista de participantes contém jogadores duplicados.' using errcode = '22023';
  end if;

  select count(*)::integer into v_existing_count
  from public.players p
  where p.id = any(p_participant_ids);

  if v_existing_count <> v_participant_count then
    raise exception 'Um ou mais participantes não existem.' using errcode = '23503';
  end if;

  if p_format = 'knockout'
     and v_participant_count not in (2, 4, 8, 16, 32) then
    raise exception 'O mata-mata exige 2, 4, 8, 16 ou 32 participantes.' using errcode = '22023';
  end if;

  insert into public.championships (name, format, starts_at, status)
  values (btrim(p_name), p_format, p_starts_at, 'draft')
  returning id into v_championship_id;

  insert into public.championship_participants (championship_id, player_id)
  select v_championship_id, value
  from unnest(p_participant_ids) as value;

  if p_format = 'league' then
    -- Same circle/rotation algorithm used by leagueFixtures() in the app.
    -- Add a sentinel for an odd number of players; pairs containing it are byes.
    v_rotation := p_participant_ids;
    if v_participant_count % 2 = 1 then
      v_rotation := v_rotation || 0::bigint;
    end if;

    v_size := cardinality(v_rotation);

    for v_round in 0..(v_size - 2) loop
      for v_index in 1..(v_size / 2) loop
        v_home := v_rotation[v_index];
        v_away := v_rotation[v_size - v_index + 1];

        if v_home <> 0 and v_away <> 0 then
          if v_round % 2 = 1 then
            v_player1 := v_away;
            v_player2 := v_home;
          else
            v_player1 := v_home;
            v_player2 := v_away;
          end if;

          insert into public.fixtures (
            championship_id, round_number, stage, player1_id, player2_id
          ) values (
            v_championship_id, v_round + 1, 'league', v_player1, v_player2
          );
        end if;
      end loop;

      -- Rotate positions 2..N: move the last element to position 2.
      v_last := v_rotation[v_size];
      for v_index in reverse 3..v_size loop
        v_rotation[v_index] := v_rotation[v_index - 1];
      end loop;
      v_rotation[2] := v_last;
    end loop;
  else
    -- Initial knockout bracket: preserve the participant order supplied by
    -- the current UI and pair adjacent players exactly as the existing code.
    v_stage := case v_participant_count
      when 2 then 'Final'
      when 4 then 'Semifinal'
      when 8 then 'Quartas de final'
      when 16 then 'Oitavas de final'
      when 32 then 'Dezesseis-avos'
    end;

    for v_index in 1..(v_participant_count / 2) loop
      insert into public.fixtures (
        championship_id, round_number, stage, player1_id, player2_id
      ) values (
        v_championship_id,
        1,
        v_stage,
        p_participant_ids[(v_index * 2) - 1],
        p_participant_ids[v_index * 2]
      );
    end loop;
  end if;

  return v_championship_id;
end;
$$;

revoke all on function public.save_championship(text, text, timestamptz, bigint[]) from public;
grant execute on function public.save_championship(text, text, timestamptz, bigint[]) to authenticated;

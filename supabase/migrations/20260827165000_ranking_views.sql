-- FC Arena ranking views.
-- Keeping ranking aggregation in PostgreSQL preserves the existing scoring rules
-- while making reads cheap and consistent across all Electron clients.

create or replace view public.ranking as
with results as (
  select player1_id as player_id, score1 as gf, score2 as ga
  from public.matches
  union all
  select player2_id as player_id, score2 as gf, score1 as ga
  from public.matches
), aggregate as (
  select
    player_id,
    count(*)::integer as played,
    sum(case when gf > ga then 1 else 0 end)::integer as wins,
    sum(case when gf = ga then 1 else 0 end)::integer as draws,
    sum(case when gf < ga then 1 else 0 end)::integer as losses,
    sum(gf)::integer as goals_for,
    sum(ga)::integer as goals_against
  from results
  group by player_id
)
select
  p.id,
  p.name,
  coalesce(a.played, 0)::integer as played,
  coalesce(a.wins, 0)::integer as wins,
  coalesce(a.draws, 0)::integer as draws,
  coalesce(a.losses, 0)::integer as losses,
  coalesce(a.goals_for, 0)::integer as "goalsFor",
  coalesce(a.goals_against, 0)::integer as "goalsAgainst",
  coalesce(a.wins * 3 + a.draws, 0)::integer as points,
  case
    when coalesce(a.played, 0) = 0 then 0::numeric
    else round(((a.wins * 3.0 + a.draws) / (a.played * 3)) * 100, 1)
  end as "winRate",
  0::integer as streak
from public.players p
left join aggregate a on a.player_id = p.id
order by points desc,
  ("goalsFor" - "goalsAgainst") desc,
  "goalsFor" desc,
  p.name;

create or replace view public.championship_standings as
with results as (
  select championship_id, player1_id as player_id, score1 as gf, score2 as ga
  from public.matches
  where championship_id is not null
  union all
  select championship_id, player2_id as player_id, score2 as gf, score1 as ga
  from public.matches
  where championship_id is not null
), aggregate as (
  select
    championship_id,
    player_id,
    count(*)::integer as played,
    sum(case when gf > ga then 1 else 0 end)::integer as wins,
    sum(case when gf = ga then 1 else 0 end)::integer as draws,
    sum(case when gf < ga then 1 else 0 end)::integer as losses,
    sum(gf)::integer as goals_for,
    sum(ga)::integer as goals_against
  from results
  group by championship_id, player_id
)
select
  cp.championship_id,
  p.id,
  p.name,
  coalesce(a.played, 0)::integer as played,
  coalesce(a.wins, 0)::integer as wins,
  coalesce(a.draws, 0)::integer as draws,
  coalesce(a.losses, 0)::integer as losses,
  coalesce(a.goals_for, 0)::integer as "goalsFor",
  coalesce(a.goals_against, 0)::integer as "goalsAgainst",
  coalesce(a.wins * 3 + a.draws, 0)::integer as points,
  case
    when coalesce(a.played, 0) = 0 then 0::numeric
    else round(((a.wins * 3.0 + a.draws) / (a.played * 3)) * 100, 1)
  end as "winRate",
  0::integer as streak
from public.championship_participants cp
join public.players p on p.id = cp.player_id
left join aggregate a
  on a.championship_id = cp.championship_id
 and a.player_id = cp.player_id;

grant select on public.ranking, public.championship_standings to authenticated;

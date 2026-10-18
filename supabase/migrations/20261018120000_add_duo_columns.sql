-- Limitação conhecida: a sala das duplas não é validada contra a do confronto
-- ou partida; resolver nas Fases 2/3.
alter table public.fixtures
  add column if not exists team1_duo_id bigint references public.teams2v2(id) on delete restrict,
  add column if not exists team2_duo_id bigint references public.teams2v2(id) on delete restrict,
  alter column player1_id drop not null,
  alter column player2_id drop not null,
  add constraint fixtures_player_or_duo check (
    (player1_id is not null and player2_id is not null and team1_duo_id is null and team2_duo_id is null)
    or (player1_id is null and player2_id is null and team1_duo_id is not null and team2_duo_id is not null)
  );

alter table public.matches
  add column if not exists team1_duo_id bigint references public.teams2v2(id) on delete restrict,
  add column if not exists team2_duo_id bigint references public.teams2v2(id) on delete restrict,
  alter column player1_id drop not null,
  alter column player2_id drop not null,
  add constraint matches_player_or_duo check (
    (player1_id is not null and player2_id is not null and team1_duo_id is null and team2_duo_id is null)
    or (player1_id is null and player2_id is null and team1_duo_id is not null and team2_duo_id is not null)
  );

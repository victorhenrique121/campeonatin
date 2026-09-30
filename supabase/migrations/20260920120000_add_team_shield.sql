-- Adiciona suporte a escudo de time sem quebrar dados existentes.
-- Idempotente: pode ser reaplicada.
alter table public.teams
  add column if not exists shield_url text;
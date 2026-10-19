ALTER TABLE public.championship_participants
  ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES public.teams(id) ON DELETE RESTRICT;

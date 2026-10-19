ALTER TABLE public.teams2v2
  ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES public.teams(id) ON DELETE RESTRICT;

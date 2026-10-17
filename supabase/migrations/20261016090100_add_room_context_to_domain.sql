alter table public.players
  add column room_id uuid references public.rooms(id) on delete restrict,
  add column created_by uuid references auth.users(id) on delete restrict;

alter table public.championships
  add column room_id uuid references public.rooms(id) on delete restrict,
  add column created_by uuid references auth.users(id) on delete restrict;

alter table public.matches
  add column room_id uuid references public.rooms(id) on delete restrict;

alter table public.fixtures
  add column room_id uuid references public.rooms(id) on delete restrict,
  add column created_by uuid references auth.users(id) on delete restrict;

alter table public.championship_participants
  add column room_id uuid references public.rooms(id) on delete restrict,
  add column created_by uuid references auth.users(id) on delete restrict;

alter table public.players drop constraint players_user_id_key;

create unique index players_room_user_id_unique_idx
  on public.players (room_id, user_id)
  where user_id is not null;

create index players_room_id_idx on public.players (room_id);
create index championships_room_id_idx on public.championships (room_id);
create index matches_room_id_idx on public.matches (room_id);
create index fixtures_room_id_idx on public.fixtures (room_id);
create index championship_participants_room_id_idx on public.championship_participants (room_id);

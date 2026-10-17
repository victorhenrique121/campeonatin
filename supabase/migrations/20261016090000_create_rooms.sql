create type public.room_member_role as enum ('owner', 'admin', 'participant');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  entry_code text not null check (entry_code = upper(entry_code) and entry_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index rooms_active_entry_code_unique_idx
  on public.rooms (entry_code)
  where deleted_at is null;

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.room_member_role not null default 'participant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index room_members_user_id_idx on public.room_members (user_id, room_id);

create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

create trigger room_members_set_updated_at
before update on public.room_members
for each row execute function public.set_updated_at();

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

grant usage on schema public to authenticated;
grant select on public.rooms, public.room_members to authenticated;

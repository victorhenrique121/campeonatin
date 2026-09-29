-- FC Arena: profile, account settings and avatar storage
-- Stage 1: database + RLS + Storage only.
-- Does not change championships, players, teams, matches or rooms.

begin;

-- ============================================================
-- 1. PROFILE FIELDS
-- ============================================================

alter table public.profiles
  add column if not exists username text,
  add column if not exists avatar_url text,
  add column if not exists bio text;

-- Existing users keep username = NULL until they choose one.
-- Usernames must already be normalized to lowercase.
alter table public.profiles
  drop constraint if exists profiles_username_format_check;

alter table public.profiles
  add constraint profiles_username_format_check
  check (
    username is null
    or username ~ '^[a-z0-9_]{3,20}$'
  );

alter table public.profiles
  drop constraint if exists profiles_bio_length_check;

alter table public.profiles
  add constraint profiles_bio_length_check
  check (
    bio is null
    or char_length(bio) <= 160
  );

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;

-- ============================================================
-- 2. USERNAME AVAILABILITY
-- ============================================================

create or replace function public.is_username_available(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_username text;
begin
  normalized_username := lower(trim(coalesce(p_username, '')));

  if normalized_username !~ '^[a-z0-9_]{3,20}$' then
    return false;
  end if;

  return not exists (
    select 1
    from public.profiles
    where username = normalized_username
  );
end;
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to authenticated;

-- ============================================================
-- 3. PROFILE UPDATE SECURITY
-- ============================================================

-- The profile owner may update only their own row.
-- Remove the previous admin-wide UPDATE policy so the profile API
-- cannot be used to edit another user's profile.
drop policy if exists profiles_update_own_or_admin on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- RLS is not column-level. This trigger makes the role protection
-- explicit at the database level: a normal authenticated user can
-- never change their own role through UPDATE. Only an already-admin
-- session may change role, which is intentionally outside the
-- profile/settings flow.
create or replace function public.prevent_non_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.user_role;
begin
  if new.role is distinct from old.role then
    select role
      into caller_role
      from public.profiles
      where id = auth.uid();

    if caller_role is distinct from 'admin'::public.user_role then
      raise exception 'A coluna role não pode ser alterada pelo usuário.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_non_admin_role_change() from public;

drop trigger if exists profiles_protect_role on public.profiles;

create trigger profiles_protect_role
before update on public.profiles
for each row
execute function public.prevent_non_admin_role_change();

-- ============================================================
-- 4. AVATARS STORAGE
-- ============================================================

-- Public bucket: files can be read without authentication.
-- Uploads are still restricted by storage.objects RLS below.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read access for avatar objects.
drop policy if exists avatars_public_read on storage.objects;

create policy avatars_public_read
on storage.objects
for select
to public
using (bucket_id = 'avatars');

-- The first path segment must be the authenticated user's UUID.
-- Example: <user-id>/avatar.webp
drop policy if exists avatars_owner_insert on storage.objects;

create policy avatars_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_owner_update on storage.objects;

create policy avatars_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_owner_delete on storage.objects;

create policy avatars_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;

-- FC Arena: leitura limitada dos perfis bloqueados pelo usuário autenticado.

create or replace function public.list_my_blocked_users()
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    p.username,
    p.avatar_url
  from public.blocked_users as b
  join public.profiles as p on p.id = b.blocked_id
  where b.user_id = (select auth.uid())
  order by lower(p.display_name), p.id;
$$;

revoke all on function public.list_my_blocked_users() from public, anon;
grant execute on function public.list_my_blocked_users() to authenticated;

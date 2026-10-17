-- ADIADA: aplicar somente depois das Fases 2 e 3, quando o app usar a sessão
-- do usuário e o SQLite estiver separado por sala. Não executar na Fase 1.
alter table public.players alter column room_id set not null;
alter table public.championships alter column room_id set not null;
alter table public.matches alter column room_id set not null;
alter table public.fixtures alter column room_id set not null;
alter table public.championship_participants alter column room_id set not null;

-- Nesta etapa futura, remover as policies globais legadas e as gates compatíveis,
-- após revisar os nomes das policies no projeto de desenvolvimento.

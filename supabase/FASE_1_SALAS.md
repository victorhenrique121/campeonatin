# Fase 1 — rascunho de salas

## Ordem de aplicação no projeto de desenvolvimento

1. Faça backup no Dashboard: Database > Backups; registre data, projeto e ponto de restauração. Exporte também o schema e os dados das tabelas afetadas.
2. Confirme visualmente que o projeto é o de desenvolvimento antes de abrir o SQL Editor. Não copie variáveis, chaves ou o `.env` para esta etapa.
3. Aplique, um por vez, `20261016090000` a `20261016090200`. Após cada uma, confira tabelas, índices, funções e políticas criados.
4. Não aplique `20261016090300` até definir o nome da sala inicial e o UUID do dono. Aplicá-la só cria a função; o backfill só ocorre numa chamada explícita.
5. Quando autorizado, execute `select public.backfill_initial_room('NOME DA SALA', 'UUID-DO-DONO');` e confira que todas as cinco tabelas receberam o mesmo `room_id` e `created_by`.
6. Aplique `20261016090400`; ela mantém o admin global e dados sem `room_id` para o app atual, mas isola linhas já atribuídas a salas.
7. Não execute nada em `supabase/deferred/` antes de concluir as Fases 2 e 3.

## Tentativas de entrada

`room_join_attempts` registra somente `user_id` e horário, nunca o código informado. `join_room` aceita no máximo cinco chamadas por usuário em quinze minutos. Código inexistente, sala removida e limite excedido retornam a mesma mensagem: `Código de entrada inválido.`

## Matriz de RLS

Crie quatro usuários confirmados: A e B pertencem à sala A; A também pertence à sala B; C não pertence a nenhuma sala. Promova A a `owner` na sala A, B a `participant`, e crie uma sala B com A como `owner`. Para cada sessão, use o JWT daquele usuário no SQL Editor/RLS Tester.

| Sessão | SELECT sala A | INSERT/UPDATE/DELETE sala A | SELECT sala B | INSERT/UPDATE/DELETE sala B |
|---|---|---|---|---|
| A owner da sala A e B | permitido | permitido | permitido | permitido |
| B participant da sala A | permitido | negado | negado | negado |
| C sem sala | negado | negado | negado | negado |

Execute os mesmos comandos abaixo para `players`, `championships`, `matches`, `fixtures` e `championship_participants`, substituindo IDs válidos da respectiva sala. O `SELECT` deve retornar apenas linhas permitidas; as escritas negadas devem afetar zero linhas ou receber erro de RLS.

```sql
select * from public.players where room_id = 'ROOM_A';
insert into public.players (room_id, name, nickname) values ('ROOM_A', 'Teste', 'teste-room-a');
update public.players set name = 'Alterado' where room_id = 'ROOM_A' and id = PLAYER_ID;
delete from public.players where room_id = 'ROOM_A' and id = PLAYER_ID;

select * from public.championships where room_id = 'ROOM_A';
insert into public.championships (room_id, name, format, starts_at) values ('ROOM_A', 'Teste', 'league', now());
update public.championships set name = 'Alterado' where room_id = 'ROOM_A' and id = CHAMPIONSHIP_ID;
delete from public.championships where room_id = 'ROOM_A' and id = CHAMPIONSHIP_ID;

select * from public.matches where room_id = 'ROOM_A';
insert into public.matches (room_id, player1_id, player2_id, team1_id, team2_id, created_by) values ('ROOM_A', PLAYER_1, PLAYER_2, TEAM_1, TEAM_2, auth.uid());
update public.matches set score1 = 1 where room_id = 'ROOM_A' and id = MATCH_ID;
delete from public.matches where room_id = 'ROOM_A' and id = MATCH_ID;
```

Para `fixtures` e `championship_participants`, use os mesmos quatro verbos com suas colunas obrigatórias. Confirme também que `select * from public.room_member_profiles('ROOM_A');` retorna somente `display_name`, `username` e `avatar_url`, sem e-mail.

## Reversão no desenvolvimento

Se uma migration ainda não recebeu dados, reverta no SQL Editor somente no projeto de desenvolvimento: remova primeiro as policies novas, depois funções, tabelas de salas e colunas `room_id`/`created_by`. Se houver dados, restaure o backup em vez de apagar registros. Nunca execute a reversão no projeto real sem um backup testado.

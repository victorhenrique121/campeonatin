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

`room_join_attempts` registra somente `user_id` e horário, nunca o código informado. `join_room(codigo)` devolve o UUID da sala ao entrar com sucesso e `NULL` para código inexistente, sala removida, usuário sem sessão ou limite atingido. Cada chamada autenticada é registrada; são aceitas no máximo cinco tentativas por usuário em quinze minutos e a sexta devolve `NULL`.

## Matriz de RLS

Crie quatro usuários confirmados: A e B pertencem à sala A; A também pertence à sala B; C não pertence a nenhuma sala. Promova A a `owner` na sala A, B a `participant`, e crie uma sala B com A como `owner`. Para cada sessão, use o JWT daquele usuário no SQL Editor/RLS Tester.

| Sessão | SELECT sala A | INSERT/UPDATE/DELETE sala A | SELECT sala B | INSERT/UPDATE/DELETE sala B |
|---|---|---|---|---|
| A owner da sala A e B | permitido | permitido | permitido | permitido |
| B participant da sala A | permitido | negado | negado | negado |
| C sem sala | negado | negado | negado | negado |

Teste explicitamente a leitura do participante: na sessão de B, `SELECT` para cada tabela de domínio com `room_id = ROOM_A` deve devolver somente os dados da sala A. O mesmo usuário não pode inserir, alterar nem excluir esses dados.

Teste o limite de entrada com uma sessão autenticada sem sala: chame `select public.join_room('CODIGO-INVALIDO');` cinco vezes, confirme cinco linhas recentes para o usuário em `room_join_attempts`, chame uma sexta vez e confirme retorno `NULL` e uma sexta linha registrada. Uma chamada com código válido durante a janela também deve devolver `NULL`.

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

## Pendências da Fase 4

- Gestão de membros: promover admin, remover participante, sair da sala e transferir propriedade.
- Gestão da sala: renomear e excluir sala.
- Decidir se participantes podem receber o `entry_code` pela API ou se ele ficará visível apenas para owner e admin.

## Reversão no desenvolvimento

Se uma migration ainda não recebeu dados, reverta no SQL Editor somente no projeto de desenvolvimento: remova primeiro as policies novas, depois funções, tabelas de salas e colunas `room_id`/`created_by`. Se houver dados, restaure o backup em vez de apagar registros. Nunca execute a reversão no projeto real sem um backup testado.

## Dívida conhecida da Fase 1

A conta de serviço (`profiles.role = 'admin'`) consegue ler dados de qualquer sala, mesmo das quais não participa. Isso acontece porque as políticas `*_room_select_gate` incluem a condição `current_user_role() = 'admin'`, necessária para o app atual funcionar enquanto a conta de serviço é a fonte de escrita.

Esse comportamento é intencional nesta fase e será removido na Fase 2, quando a conta de serviço for substituída pela sessão do usuário. Não aplicar a migration adiada (`supabase/deferred/20261016090500`) antes da Fase 3: ela também está incompleta (falta a remoção das políticas de admin global).

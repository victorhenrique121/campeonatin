# FC Arena — Guia e plano de trabalho para o Codex

Este arquivo fica na **raiz do repositório** (`AGENTS.md`). Leia-o inteiro antes de qualquer alteração.

## 1. Contexto

FC Arena é um app desktop (Electron + React + TypeScript + Vite) para gerenciar campeonatos de EA FC entre amigos.
Objetivo final: sair de "gerenciador local" e virar uma **plataforma online**, em que cada pessoa tem conta e perfil e os campeonatos acontecem dentro de **salas** compartilhadas por código.

Estado atual (já funciona, não quebrar):
- Cadastro, login, verificação de e-mail, sessão, logout e reenvio com contador.
- Perfil (`ProfilePage`), Configurações (Conta, Senha, E-mail, Aparência, Sobre, Notificações, Privacidade).
- Avatar no Supabase Storage, `username` único, proteção da coluna `role` por trigger.
- Dados de jogadores, times, partidas e campeonatos funcionando (modo híbrido, ver seção 3).

Estado do plano: **Fase 0 concluída** (PR #8 mergeado no `main`; typecheck, lint e 8 testes passam). Próxima: **Fase 1**. As decisões da seção 6 estão fechadas.

## 2. Regras inegociáveis

1. **Nunca declare algo pronto sem rodar `npm run typecheck` e informar o resultado real.** Se não conseguir rodar, diga isso claramente. Um commit anterior quebrou o build porque ninguém rodou.
2. **Trabalhe em branch própria por fase** (`feat/<fase>`) e entregue como PR pequeno. Não dê push direto na `main`.
3. **Uma fase por vez.** Ao terminar uma fase, pare e entregue o relatório (seção 8). Não avance sem aprovação.
4. **Segurança primeiro.** Nunca enfraquecer RLS nem a proteção de `profiles.role`. Toda regra de segurança vive no banco; o front-end não conta como barreira.
5. **Nunca commitar segredos.** `.env` fica fora do git. Nunca escrever senhas, tokens ou chaves em logs, mensagens de erro ou testes.
6. **Migrations:** escreva os arquivos em `supabase/migrations/`, mas **não aplique** em nenhum projeto. Quem aplica sou eu, primeiro em um projeto de desenvolvimento.
7. **Não apagar** funções, tabelas ou migrations só por limpeza. Se algo ficar sem uso, liste no relatório.
8. **Mensagens ao usuário em português**, sem termos técnicos. Nunca mostrar nomes de canais IPC, stack traces ou texto em inglês do Supabase. Use a função central de mensagens amigáveis (remove o prefixo `Error invoking remote method '...'`). Erro desconhecido: "Algo deu errado. Tente novamente em instantes."
9. **Estilo:** siga os padrões já existentes. Não reescreva arquivos inteiros para ajustar detalhes.
10. Se uma instrução conflitar com estas regras ou algo estiver ambíguo, **pergunte antes de agir**.

## 3. Arquitetura (como é hoje)

```text
src/main/        processo principal (Electron)
  supabase.ts    dois clientes: serviço (dados) e userAuthClient (login/perfil)
  index.ts       handlers IPC (ipcMain.handle)
  repository.ts  SQLite local (better-sqlite3): ranking, dashboard, partidas
  players-service.ts, matches-service.ts, championship-service.ts, teams-service.ts
src/preload/     expõe window.arena ao renderer
src/shared/api.ts  contratos de tipos entre renderer, preload e main
src/renderer/    React (main.tsx ~3500 linhas, settings/, ProfilePage, AuthPage)
supabase/migrations/  schema e RLS
```

Fluxo de uma operação: `renderer → preload → IPC → service → Supabase`.
Ao adicionar uma operação, **os quatro pontos precisam ter o mesmo nome e o mesmo formato de argumento**: tela, preload, `shared/api.ts` e handler. Divergência aqui já causou o erro "changeEmail is not a function".

**Modo híbrido:** escritas vão ao Supabase (fonte de verdade); leituras, ranking, dashboard e lista de partidas vêm de um **espelho SQLite** sincronizado por `syncMirror`. Offline: leitura pelo espelho, escrita recusada. O SQLite não é fonte de autorização.

**Problema conhecido (prioridade):** os serviços de dados autenticam com uma **conta de serviço** (`SUPABASE_APP_EMAIL` / `SUPABASE_APP_PASSWORD` no `.env`), com `role = admin`. Isso faz os dados pertencerem ao app inteiro e coloca uma senha de admin dentro de um app distribuível. O RLS atual é "authenticated lê, admin escreve".

**Regras do jogo:** fixas em 3/1/0 e mínimo 3 para Melhor Forma, em constante única, via `repository.gameRules()`.

## 4. Comandos

```bash
npm ci
npm run typecheck   # tsc --noEmit && tsc -p tsconfig.electron.json --noEmit
npm run dev
```

Preload e processo principal só atualizam ao **reiniciar o app**. Hot reload não basta para testar IPC.

**Ambiente (Windows):** o `better-sqlite3` pode não compilar nesta máquina (Visual Studio Build Tools 18 não é reconhecido pelo node-gyp). Use `npm ci --ignore-scripts` para typecheck, lint e testes, e não rode o app nem testes que abram o SQLite sem confirmar que o módulo nativo está compilado. A configuração do Vitest fica em `vitest.config.ts` (nunca no `vite.config.ts`, causa erro TS2769), e o `--root .` do script `test` deve ser mantido.

**Projetos Supabase:** existem um projeto **real** e um de **desenvolvimento**. Toda migration e todo teste de RLS rodam **somente no de desenvolvimento**. O `.env` aponta para um deles por vez: antes de rodar qualquer coisa, confira o `SUPABASE_URL`. Há contas de teste (dev1, dev2) criadas no projeto de desenvolvimento, com e-mail confirmado. Nunca crie um login que pule a autenticação no código.

## 5. Decisões já fechadas (modelo de salas)

- Um usuário pode estar em **várias salas** (relação N:N).
- `teams` é **catálogo global somente leitura**. Sem `room_teams` por enquanto.
- Código de entrada **permanente**, com **regeneração manual** por owner e admin.
- Papéis na sala: `owner`, `admin`, `participant`. **Só o owner cria admins.** O owner só sai depois de transferir a propriedade.
- Exclusão de sala por **soft delete** (`deleted_at`).
- Jogadores, campeonatos e partidas: **escrita por owner e admin**; participantes só leem.
- `players` é cadastro do organizador; prever `players.user_id` **opcional** para vincular a uma conta no futuro, sem implementar agora.
- Busca por `@username` **desligada**. Entrada só por código.
- Offline: **somente leitura**.
- `profiles.role` (admin/player/viewer) é global e **não dá acesso a nenhuma sala**. O papel dentro da sala vem de `room_members.role`.
- Dono da sala inicial: a conta que eu indicar na migração.
- **Partidas: lançadas só por owner e admin.** Confirmação do resultado pelo adversário fica para a Fase 6.
- **Espelho SQLite: um arquivo por sala** (`room-<id>.sqlite`). O SQL de ranking e dashboard não muda e não há como misturar salas.

## 6. Decisões pendentes

Nenhuma no momento. As duas que estavam abertas foram fechadas na seção 5 (partidas só pelo organizador; um SQLite por sala).

## 7. Plano em fases

Cada fase tem critérios de aceite. Só passa para a próxima com minha aprovação.

### Fase 0 — Base de qualidade (sem mudar comportamento) — CONCLUÍDA (PR #8)
- Adicionar workflow de CI (GitHub Actions) rodando `npm ci` e `npm run typecheck` em PRs.
- Adicionar ESLint e um script `npm run lint`, com regras conservadoras.
- Adicionar testes automatizados (Vitest) para a lógica pura: ranking, normalização de username, validação de e-mail e senha, função central de erros.
- Dividir `src/renderer/main.tsx` em módulos (páginas e componentes), **sem alterar comportamento nem visual**.
- **Aceite:** CI verde; telas idênticas; typecheck e testes passando.

### Fase 1 — Modelo de dados das salas (rascunho, não aplicado)
Ordem obrigatória, para os dados atuais não ficarem invisíveis:
1. Criar `rooms` e `room_members`.
2. Adicionar `room_id` **nullable** nas tabelas de domínio.
3. Fazer o **backfill** de `room_id` e `created_by` pela migration parametrizada `20261016090300_prepare_initial_room_backfill.sql`.
4. Somar as políticas por sala às políticas atuais pela migration `20261016090400_add_compatible_room_rls.sql`; o app ainda usa a conta de serviço, portanto as políticas globais da migration inicial **não podem ser removidas** nesta fase.
5. Só por último, depois de concluir as Fases 2 e 3, aplicar `supabase/deferred/20261016090500_enforce_room_scope_after_phase_3.sql`, que torna `room_id` NOT NULL e remove o admin global.
- Funções com `SECURITY DEFINER` e `search_path` fixo: `is_room_member(room_id)` (usa `auth.uid()`, nunca recebe o usuário como argumento), `room_member_role(room_id)` e `room_member_profiles(room_id)`, que devolve somente `display_name`, `username` e `avatar_url`, sem e-mail.
- `create_room(name)` e `join_room(code)` como RPC transacional. Código aleatório sem caracteres ambíguos (alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), limite de tentativas e mensagem única para código inválido, sem revelar se a sala existe.
- **Entregáveis:** arquivos de migration **não aplicados**, matriz de testes de RLS (usuário A na sala A, A na sala B, usuário B na sala A, usuário sem sala; SELECT/INSERT/UPDATE/DELETE por papel) e roteiro para testar em projeto de desenvolvimento.
- **Escopo:** apenas arquivos de migration e testes. Nada é aplicado pelo agente e nenhum código do app muda nesta fase.
- **Aceite:** eu aplico no projeto de **desenvolvimento** e todos os testes da matriz passam.

### Fase 2 — Sessão do usuário no lugar da conta de serviço
- Trocar a conta de serviço pela sessão do `userAuthClient` em `players`, `teams`, `championships`, `matches`, nessa ordem, **um serviço por PR**. Depois o `syncMirror`.
- `created_by = auth.uid()`, validado pelo banco.
- **Não remover** a conta de serviço ainda.
- **Aceite:** cada serviço funciona só com a sessão do usuário, e usuário sem sala não lê nem escreve nada.

### Fase 3 — Espelho SQLite por sala
- Implementar **um arquivo SQLite por sala** (decisão da seção 5). Trocar de sala descarta o contexto anterior (`activeRoomId`) e resincroniza.
- Repositório exige `roomId` explícito (`getRanking(roomId)`), nunca consulta sem sala.
- **Aceite:** teste automatizado mostrando que dados da sala A nunca aparecem na sala B (ranking, dashboard, jogadores, partidas, campeonatos).

### Fase 4 — Interface de salas
- Telas: criar sala, entrar com código, seletor de sala, trocar sala, sair da sala. Entrada automática se houver só uma sala.
- Mostrar o código com botão de copiar, e regenerar para owner e admin.
- Todos os textos em português; estados de carregando, sucesso e erro.
- **Aceite:** fluxo completo com duas contas reais em dois computadores.

### Fase 5 — Migração dos dados antigos e fim da conta de serviço
- Rodar o backfill na sala inicial com o owner indicado e reconstruir o SQLite a partir do Supabase.
- Remover `SUPABASE_APP_EMAIL/PASSWORD` do app e do `.env.example`.
- Eu troco a senha da conta de serviço e revogo suas sessões.
- **Aceite:** o app funciona sem nenhuma credencial administrativa no cliente.

### Fase 6 — Recursos sociais (depois, com decisão do item pendente)
Jogadores vinculados a contas, confirmação de resultados pelo adversário, estatísticas no perfil calculadas a partir das partidas (nunca contadores em `profiles`), exportar meus dados, convites e busca por `@username` com a opção de privacidade correspondente.

### Adiados (não implementar sem eu pedir)
SMTP próprio, modelos de e-mail traduzidos, "Esqueci minha senha", Auth Hook de e-mail, autenticação em dois fatores (TOTP), ajustes finos de cores.

## 8. Formato do relatório ao fim de cada fase

1. O que foi feito e o que **não** foi feito.
2. Arquivos criados e alterados, e o PR ou branch.
3. Resultado real de `npm run typecheck`, lint e testes (saída copiada).
4. Código que ficou sem uso (listado, não apagado).
5. Como eu testo, passo a passo, e o que conferir no painel do Supabase.
6. Riscos encontrados e perguntas em aberto.

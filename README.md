# FC Arena

Aplicação desktop para organizar partidas, jogadores, times, rankings e campeonatos de **EA Sports FC** entre amigos.

Os dados ficam em um banco **SQLite local**, com uma camada opcional de sincronização com **Supabase** (PostgreSQL) sendo adicionada de forma incremental. A aplicação funciona 100% offline — o Supabase é opcional e nunca é pré-requisito para usar o app.

> **Status:** em desenvolvimento ativo.
> Núcleo de partidas, ranking, estatísticas e campeonatos implementado.
> A integração com Supabase é incremental: `players` e `teams` possuem integração remota; `matches` já possui fluxo híbrido de escrita; `championships` e `fixtures` ainda dependem principalmente do SQLite.

---

## Sumário

- [Visão geral](#visão-geral)
- [Arquitetura de dados](#arquitetura-de-dados)
- [Funcionalidades](#funcionalidades)
- [Campeonatos](#campeonatos)
- [Ranking](#ranking)
- [Arquitetura técnica](#arquitetura-técnica)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Tecnologias](#tecnologias)
- [Instalação](#instalação)
- [Desenvolvimento](#desenvolvimento)
- [Configuração do Supabase (opcional)](#configuração-do-supabase-opcional)
- [Scripts disponíveis](#scripts-disponíveis)
- [Build para Windows](#build-para-windows)
- [Banco de dados](#banco-de-dados)
- [Modelo de dados](#modelo-de-dados)
- [Validações](#validações)
- [Segurança](#segurança)
- [Backup e restauração](#backup-e-restauração)
- [Solução de problemas](#solução-de-problemas)
- [Roadmap](#roadmap)
- [Filosofia do projeto](#filosofia-do-projeto)
- [Licença](#licença)

---

## Visão geral

O FC Arena é um gerenciador local de campeonatos e partidas de EA Sports FC.

Permite cadastrar jogadores, utilizar um catálogo de clubes reais, registrar resultados, consultar estatísticas e criar campeonatos com calendário (pontos corridos) ou chave eliminatória (mata-mata).

O banco de dados é acessado exclusivamente pelo processo principal do Electron. A interface React não acessa o SQLite diretamente: ela consome uma API exposta pelo preload via IPC, com `contextIsolation` ativo.

### Principais objetivos

- Centralizar os resultados das partidas.
- Eliminar cálculos manuais de classificação.
- Organizar campeonatos entre amigos.
- Gerar confrontos automaticamente.
- Manter os dados sob controle do usuário.
- Permitir backup e restauração do banco.

---

## Arquitetura de dados

O projeto está migrando gradualmente do SQLite local para o Supabase, **uma entidade por vez**, sem quebrar nada que já funciona.

### Princípio: espelho local com IDs preservados

As tabelas são fortemente acopladas por chaves estrangeiras e JOINs no SQLite — ranking, dashboard, estatísticas e chaveamento dependem disso. Se uma entidade migrasse para o Supabase com IDs diferentes, todos esses vínculos locais quebrariam.

A solução adotada: **o Supabase vira fonte de verdade, mas toda linha também é espelhada localmente com o mesmo ID**. Assim, as FKs e JOINs locais continuam íntegros e o `repository.ts` nunca precisa ser alterado.

### Estado atual por entidade

| Entidade | Onde vive | Padrão adotado |
|---|---|---|
| `players` | Supabase + espelho local | Fonte de verdade remota. Escrita e leitura remotas, com fallback local para leitura offline. |
| `teams` | Supabase + catálogo local | Leitura remota com fallback local. **Escrita apenas por script manual** — o app nunca escreve no catálogo remoto. |
| `matches` | SQLite | Ainda 100% local. Migração planejada (escrita remota + leitura local). |
| `championships` | SQLite | Ainda 100% local. |
| `fixtures` | SQLite | Ainda 100% local. |
| `championship_participants` | SQLite | Sem equivalente no schema remoto. |

### Modo legado

**Sem arquivo `.env` configurado, a aplicação funciona exatamente como antes da migração: 100% SQLite local.** Nenhuma funcionalidade é perdida e nenhum erro é exibido. Isso é uma garantia de projeto, não um efeito colateral.

Quando o Supabase está configurado mas indisponível (offline, credencial inválida), a leitura cai no espelho local e a escrita é bloqueada com mensagem clara — evitando divergência silenciosa entre os bancos.

---

## Funcionalidades

### Dashboard

Tela inicial com visão geral:

- quantidade de jogadores e de partidas;
- líder do ranking;
- time mais utilizado;
- partidas recentes;
- ranking geral.

Todas as estatísticas são derivadas das partidas registradas — não há tabela de ranking duplicada que possa ficar inconsistente.

### Jogadores

- Cadastro com nome e apelido (apelido é **único**).
- Armazenamento de avatar quando disponível.
- Listagem e exclusão.
- Ao excluir um jogador, os registros relacionados são removidos conforme as regras de integridade, dentro de uma transação.

### Times

Catálogo local com **662 clubes reais**, contendo nome, liga e país. Pesquisável na interface de registro de partidas.

O catálogo é semeado automaticamente na inicialização a partir de `clubRows.ts`. Também existem scripts para regenerar o catálogo a partir de dados CSV.

### Partidas

- Registro com dois jogadores, dois times e placar.
- Associação opcional a um campeonato (ou partida avulsa).
- Histórico completo.
- Edição de resultados já registrados.
- Limpeza do histórico.

Validações impedem que um jogador enfrente a si mesmo ou que ambos os lados usem o mesmo time.

---

## Sistema de partidas

Cada partida contém: jogador 1, jogador 2, time de cada jogador, placar de cada lado, campeonato opcional e data/hora.

### Partida avulsa

Sem campeonato selecionado, a partida entra apenas no histórico geral e no ranking global.

### Partida de campeonato

Com campeonato selecionado, o sistema verifica se o confronto corresponde a um `fixture` **pendente** daquele campeonato. Após o registro:

1. a partida é salva;
2. o `fixture` correspondente recebe o `match_id`;
3. a classificação é recalculada a partir das partidas;
4. em mata-mata, o vencedor avança automaticamente para a próxima fase.

Todo esse fluxo roda dentro de uma transação SQLite.

---

## Campeonatos

### Pontos corridos (`league`)

Ao criar o campeonato, o sistema gera automaticamente todas as rodadas usando um algoritmo de calendário (round-robin).

Suporta número par ou ímpar de participantes — quando ímpar, um participante fictício (`bye`) é usado internamente para montar as rodadas.

Cada confronto vira um `fixture`, que depois recebe o resultado da partida. A classificação usa somente as partidas daquele campeonato.

### Mata-mata (`knockout`)

Participantes permitidos: **2, 4, 8, 16 ou 32**.

A fase inicial é determinada automaticamente:

| Participantes | Fase inicial |
|---:|---|
| 2 | Final |
| 4 | Semifinal |
| 8 | Quartas de final |
| 16 | Oitavas de final |
| 32 | Dezesseis-avos |

Empates são bloqueados nas fases eliminatórias. Quando todos os confrontos de uma fase são concluídos, os vencedores são identificados e a próxima fase é gerada automaticamente. Ao concluir a última partida, o campeonato é marcado como `finished`.

### Tela de detalhes

Apresenta participantes, classificação (quando aplicável), calendário de rodadas, chave eliminatória, confrontos pendentes, partidas registradas e placares. O registro de resultado pode ser iniciado direto de um confronto pendente.

---

## Ranking

Calculado diretamente a partir da tabela `matches`, com pontuação tradicional:

```text
Vitória = 3 pontos
Empate  = 1 ponto
Derrota = 0 pontos
```

Estatísticas: partidas jogadas, vitórias, empates, derrotas, gols marcados, gols sofridos, saldo de gols, pontos e aproveitamento.

**Critérios de desempate**, nesta ordem: pontos → saldo de gols → gols marcados → nome do jogador.

O ranking de campeonato considera apenas partidas cujo `championship_id` corresponde ao campeonato selecionado.

---

## Arquitetura técnica

```text
┌──────────────────────────────┐
│       React Renderer         │
│   Interface e estado da UI   │
└───────────────┬──────────────┘
                │  window.arena
                ▼
┌──────────────────────────────┐
│           Preload            │
│    contextBridge + IPC       │
└───────────────┬──────────────┘
                │  ipcRenderer.invoke
                ▼
┌──────────────────────────────┐
│        Electron Main         │
│       ipcMain.handle         │
└───────────────┬──────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌───────────────┐  ┌──────────────────┐
│  Repository   │  │  Services        │
│    SQLite     │  │  Supabase        │
│               │  │  (players/teams) │
└───────────────┘  └──────────────────┘
```

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Renderer | `src/renderer/main.tsx` | Interface React, formulários, modais, listas |
| Preload | `src/preload/index.ts` | Ponte segura via `contextBridge` |
| Main | `src/main/index.ts` | Janela do Electron e handlers IPC |
| Repository | `src/main/repository.ts` | Acesso ao SQLite e regras de negócio |
| Services | `src/main/*-service.ts` | Camada de dados por entidade migrada |
| Supabase | `src/main/supabase.ts` | Cliente, autenticação e diagnóstico de conexão |
| Shared | `src/shared/` | Modelos TypeScript e contrato da API IPC |

### Fluxo de dados — exemplo

```text
Usuário → Formulário React → window.arena.saveMatch(...)
   → preload / ipcRenderer.invoke
   → ipcMain.handle("matches:save")
   → repository.saveMatch(...)
   → SQLite
```

Para entidades já migradas, o service correspondente escreve primeiro no Supabase e depois espelha localmente com o mesmo ID.

---

## Estrutura do projeto

A estrutura atual separa interface, processo Electron, contratos compartilhados, scripts e infraestrutura do Supabase:

```text
campeonatin/
│
├── .github/
│   └── workflows/
│       ├── codeql.yml
│       └── copilot-instructions.md
│
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── repository.ts
│   │   ├── supabase.ts
│   │   ├── players-service.ts
│   │   ├── teams-service.ts
│   │   ├── matches-service.ts
│   │   ├── championship-service.ts
│   │   ├── clubRows.ts
│   │   └── scripts/
│   │       ├── generate-clubs.ts
│   │       └── FC26_20250921.csv
│   │
│   ├── preload/
│   │   └── index.ts
│   │
│   ├── renderer/
│   │   ├── main.tsx
│   │   ├── appearance.ts
│   │   ├── HeadToHeadCard.tsx
│   │   └── styles/
│   │
│   ├── shared/
│   │   ├── api.ts
│   │   └── models.ts
│   │
│   └── midia/
│
├── scripts/
│   ├── migrate-players-to-supabase.mjs
│   ├── migrate-teams-to-supabase.mjs
│   ├── migrate-matches-to-supabase.mjs
│   ├── migrate-champions-to-supabase.mjs
│   └── dev-tests/
│       ├── mock-supabase.cjs
│       ├── scenarios.cjs
│       ├── run-stage2-tests.cjs
│       └── run-stage4-tests.cjs
│
├── supabase/
│   ├── SETUP.md
│   └── migrations/
│       └── 20260827160000_initial_schema.sql
│
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.electron.json
├── vite.config.ts
└── README.md
```

### Responsabilidade de cada área

| Pasta | Responsabilidade |
|---|---|
| `src/main/` | Electron Main, SQLite, IPC handlers e serviços |
| `src/preload/` | Ponte segura entre Renderer e Main |
| `src/renderer/` | React, telas, componentes e estilos |
| `src/shared/` | Tipos e contratos compartilhados |
| `src/midia/` | Ícones e assets da aplicação |
| `scripts/` | Migrações, testes e ferramentas auxiliares |
| `supabase/` | Migrations e documentação do banco remoto |
| `.github/` | CI e automações do GitHub |

### Arquivos antigos na raiz

O repositório ainda contém alguns arquivos que podem ser reorganizados futuramente:

- `check-db.js` — ferramenta de diagnóstico do SQLite;
- `clubRows.ts` — existe também a versão utilizada em `src/main/clubRows.ts`;
- `FIXES_SUMMARY.md` — documentação que pode ficar em `docs/`;
- `__tmp_probe__.txt` — aparenta ser temporário.

**Não remova esses arquivos automaticamente.** Antes de mover ou excluir, confirme referências no projeto.

## Tecnologias

| Tecnologia | Uso |
|---|---|
| Electron | Aplicação desktop |
| React | Interface |
| TypeScript | Tipagem e desenvolvimento |
| Vite | Build e servidor de desenvolvimento |
| SQLite (`better-sqlite3`) | Banco de dados local |
| Supabase (`@supabase/supabase-js`) | Sincronização em nuvem (opcional) |
| Lucide React | Ícones |
| Electron Builder | Empacotamento |
| concurrently / wait-on | Orquestração do ambiente de dev |
| csv-parser | Processamento do catálogo de clubes |

Versões exatas estão no `package.json`.

---

## Instalação

**Requisitos:**

- Node.js **20.12 ou superior** (o projeto usa `process.loadEnvFile`, API nativa a partir dessa versão)
- npm
- Windows recomendado para o fluxo atual de empacotamento

```bash
git clone https://github.com/victorhenrique121/campeonatin.git
cd campeonatin
npm install
```

Se precisar usar cache local de pacotes:

```powershell
npm install --cache .npm-cache
```

---

## Desenvolvimento

> ### ⚠️ Leia antes de rodar
>
> O processo principal do Electron precisa ser compilado antes de abrir o aplicativo.
>
> O script atual `dev:electron` já executa `tsc -p tsconfig.electron.json` automaticamente.
>
> Se precisar compilar manualmente:
>
> ```bash
> npx tsc -p tsconfig.electron.json
> ```
>
> Sem isso, o Electron carrega uma versão antiga do código e suas mudanças simplesmente não aparecem — **sem nenhum erro ou aviso**.

Fluxo recomendado:

```bash
npm run dev                          # compila o Main, inicia Vite e abre o Electron

# ou, para compilar somente o processo Main:
npx tsc -p tsconfig.electron.json
```

O Electron aguarda o servidor Vite (porta 5173) ficar disponível antes de abrir a janela.

### Verificação de tipos

```bash
npm run typecheck
```

Verifica o TypeScript do renderer e do processo Electron sem gerar arquivos.

### Testes

```bash
npm run test:stage2
```

Executa a suíte de cenários contra um **mock local de Supabase** (GoTrue + PostgREST), cobrindo: modo legado, fluxo remoto completo, persistência de sessão, comportamento offline, credenciais inválidas, tabela ausente e sincronização de espelho.

Os testes rodam **100% offline** — não requerem acesso ao Supabase real.

---

## Configuração do Supabase (opcional)

> Esta seção é **opcional**. Sem ela, a aplicação funciona normalmente em modo SQLite local.

O guia completo está em [`supabase/SETUP.md`](supabase/SETUP.md). Resumo dos passos:

1. **Aplicar a migration** — cole o conteúdo de `supabase/migrations/*.sql` no SQL Editor do Supabase e execute.
2. **Criar a conta de serviço** — em `Authentication → Users`, crie um usuário com e-mail e senha.
3. **Promover a conta a admin** — no SQL Editor:
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE id = '<uuid-do-usuario>';
   ```
4. **Configurar o `.env`** — copie `.env.example` para `.env` e preencha:
   ```dotenv
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_ANON_KEY=sua-chave-anon-publica
   SUPABASE_APP_EMAIL=conta-de-servico@exemplo.com
   SUPABASE_APP_PASSWORD=senha-da-conta-de-servico
   ```
5. **Migrar o catálogo de times:**
   ```bash
   npm run migrate:teams
   ```
   Ao final, o script imprime um comando `setval` — **execute-o no SQL Editor**. Ele é obrigatório.
6. **Validar** — rode `npm run dev` e confira o log `[supabase]` no terminal.

### Notas importantes

- **Nunca use a `service_role` key.** O projeto usa exclusivamente a chave pública `anon` combinada com login de uma conta de serviço comum via Supabase Auth. Se a variável `SUPABASE_SERVICE_ROLE_KEY` for detectada no ambiente, o app exibe um aviso e a ignora.
- As variáveis são lidas **apenas no processo main**, nunca expostas ao renderer.
- Não use prefixo `VITE_` nos nomes — variáveis com esse prefixo não são visíveis ao processo main.
- O `.env` é ignorado pelo Git por padrão e **não é empacotado** no build de produção.

---

## Scripts disponíveis

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia Vite + Electron simultaneamente |
| `npm run dev:electron` | Compila o Main, aguarda o Vite e abre o Electron |
| `npm run typecheck` | Verificação TypeScript (renderer + main) |
| `npm run build` | Compila, gera o frontend e empacota a aplicação |
| `npm run test:stage2` | Suíte de cenários contra o mock de Supabase |
| `npm run migrate:players` | Migra jogadores do SQLite para o Supabase |
| `npm run migrate:teams` | Migra o catálogo de times para o Supabase |
| `npm run migrate:matches` | Migra o histórico de partidas para o Supabase |
| `npm run migrate:champions` | Executa a migração de campeonatos |
| `npm run start` | Inicialização via Electron Forge |
| `npm run package` | Empacotamento via Electron Forge |
| `npm run make` | Geração de artefatos via Electron Forge |
| `npx tsc -p tsconfig.electron.json` | Compila somente o processo Main |

### Sobre os scripts de migração

Os scripts de migração preservam os IDs originais e usam upsert quando aplicável, permitindo repetir a migração sem criar registros duplicados. Aceitam um caminho de banco como argumento:

```bash
npm run migrate:teams -- /caminho/para/fc-arena.sqlite
```

Como inserem com IDs explícitos, a sequência do PostgreSQL não avança automaticamente. Por isso, **cada script imprime ao final um comando `setval` que deve ser executado uma vez no SQL Editor**. Pular esse passo causa conflito de ID (`23505`) em inserções futuras.

---

## Build para Windows

```bash
npm run build
```

O processo executa, em sequência:

1. compilação do código Electron (`tsc -p tsconfig.electron.json`);
2. build do frontend com Vite;
3. empacotamento via Electron Builder (alvo NSIS).

| Identificador | Valor |
|---|---|
| App ID | `com.fcarena.desktop` |
| Nome do produto | `FC Arena` |

> **Atenção:** o arquivo `.env` **não é incluído** no pacote. Um app distribuído roda em modo SQLite local. Um mecanismo de configuração em produção (tela de settings + `safeStorage`) ainda está pendente.

---

## Banco de dados

SQLite via `better-sqlite3`, criado no diretório de dados do usuário do Electron:

```text
fc-arena.sqlite
```

Caminhos típicos:

| Sistema | Local |
|---|---|
| Windows | `%APPDATA%\fc-arena\fc-arena.sqlite` |
| macOS | `~/Library/Application Support/fc-arena/` |
| Linux | `~/.config/fc-arena/` |

### Configuração e integridade

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

Existem índices para as consultas frequentes (partidas por data, por jogadores, fixtures por campeonato/rodada). Relacionamentos usam `ON DELETE` para controlar o comportamento em cascata, e operações que tocam várias tabelas rodam dentro de transações.

### Tabelas

| Tabela | Conteúdo |
|---|---|
| `players` | Jogadores: `id`, `name`, `nickname` (único), `avatar`, `created_at` |
| `teams` | Catálogo de clubes: `id`, `name`, `league`, `country` |
| `matches` | **Fonte de verdade dos resultados**: jogadores, times, placar, campeonato, data |
| `championships` | Campeonatos: `id`, `name`, `format`, `starts_at`, `status` |
| `championship_participants` | Relação jogador ↔ campeonato, chave composta |
| `fixtures` | Confrontos previstos: campeonato, rodada, fase, jogadores, partida vinculada |

Formatos de campeonato previstos no modelo: `league`, `knockout`, `groups_knockout`. O formato `groups_knockout` existe no domínio, mas a funcionalidade ainda não foi implementada.

### Inicialização

Na primeira execução, o repository: abre ou cria o banco → habilita foreign keys e WAL → cria tabelas e índices ausentes → aplica ajustes de estrutura necessários → garante que o catálogo de clubes esteja populado.

Uma instalação nova é inicializada sem nenhuma configuração manual.

---

## Modelo de dados

```ts
type Player = {
  id: number;
  name: string;
  nickname: string;
  avatar?: string;
  createdAt: string;
};

type Team = {
  id: number;
  name: string;
  league: string;
  country: string;
};

type Championship = {
  id: number;
  name: string;
  format: "league" | "knockout" | "groups_knockout";
  startsAt: string;
  status: "draft" | "active" | "finished";
  participants: number;
};
```

`Match` representa uma partida registrada (jogadores, times, placar, campeonato opcional, data). `Fixture` representa um confronto previsto, antes ou depois de receber o resultado. `ChampionshipDetail` agrupa dados do campeonato, classificação e confrontos.

### API IPC

Contrato tipado entre renderer e processo principal:

```text
dashboard          championships
players            championshipDetail
savePlayer         saveChampionship
deletePlayer       backup
teams              restore
matches            ranking
saveMatch          clearMatches
updateMatch
```

---

## Validações

Validações existem tanto na interface quanto no processo principal — este último é o que garante integridade, já que a UI não pode ser a única barreira.

- Nome e apelido de jogador obrigatórios; apelido único.
- Mínimo de dois participantes em campeonatos.
- Quantidade válida de participantes para mata-mata (2, 4, 8, 16, 32).
- Jogadores diferentes em uma partida.
- Times diferentes em uma partida.
- Jogadores e times devem existir no banco.
- Campeonato deve existir quando selecionado.
- Placares inteiros e não negativos.
- Confronto deve pertencer ao campeonato selecionado.
- Empate bloqueado em fases eliminatórias.

---

## Segurança

### Isolamento do renderer

```ts
contextIsolation: true
nodeIntegration: false
```

O renderer não tem acesso direto a APIs Node.js nem ao SQLite. Toda comunicação passa pelo `contextBridge`, com superfície de API controlada e tipada.

### Credenciais

- Credenciais do Supabase existem **apenas no processo main** e nunca cruzam a ponte IPC.
- Somente a chave pública `anon` é usada, combinada com autenticação de conta de serviço.
- A `service_role` key nunca é lida nem utilizada — se detectada no ambiente, gera aviso.
- O `.env` é gitignored e não acompanha o build de produção.

> **Pendência conhecida:** a sessão da conta de serviço é persistida em texto claro em `userData/supabase-session.json`. Migrar para `safeStorage` do Electron antes de qualquer distribuição pública.

---

## Backup e restauração

### Backup

O usuário escolhe onde salvar uma cópia do banco SQLite. Nome sugerido:

```text
fc-arena-backup.sqlite
```

### Restauração

O usuário seleciona um arquivo SQLite compatível. Após a restauração, a aplicação é reiniciada para usar o banco restaurado.

> Faça sempre um backup antes de restaurar uma versão anterior.

> **Nota:** backup, restauração, exportação e importação operam **somente sobre o SQLite**. Se o Supabase estiver configurado, essas operações podem gerar divergência entre os dois bancos. O tratamento disso está no roadmap.

---

## Solução de problemas

### Alterei o código mas nada muda no app

A causa quase certa: o processo main não foi recompilado.

```bash
npx tsc -p tsconfig.electron.json
```

Esse é o problema mais comum do projeto. O app abre normalmente, sem erro, executando código antigo.

### O log diz `not-configured` mesmo com o `.env` preenchido

Verifique os nomes das variáveis. O processo main lê exatamente `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_APP_EMAIL` e `SUPABASE_APP_PASSWORD`. Prefixos `VITE_` **não funcionam** aqui.

Confirme também que o arquivo se chama `.env` e não `.env.txt` (o Windows esconde extensões):

```powershell
dir -Force .env*
```

### `captcha protection: request disallowed`

O Supabase está bloqueando o login programático da conta de serviço. Desative em `Authentication → Attack Protection`.

### Centenas de erros `TS1005` / `TS1128` de uma vez

Erros de sintaxe em cascata concentrados em um único arquivo geralmente têm **uma causa só**: marcador de conflito de merge esquecido ou bloco de código duplicado.

```powershell
Select-String -Path "src\main\arquivo.ts" -Pattern "<<<<<<<|=======|>>>>>>>"
```

### `Missing script` ou `Cannot find module` em um script

O arquivo não existe na máquina. Confirme com `dir scripts` antes de investigar qualquer outra hipótese.

### Erro `23505` (duplicate key) ao criar registro novo

O comando `setval` não foi executado após a migração de dados. Rode no SQL Editor:

```sql
select setval(
  pg_get_serial_sequence('public.<tabela>', 'id'),
  (select coalesce(max(id), 1) from public.<tabela>)
);
```

### A lista de times aparece vazia com o Supabase configurado

A tabela remota `teams` ainda não foi populada. Execute `npm run migrate:teams` e aplique o `setval` impresso ao final.

---

## Roadmap

### Base já implementada

- [x] Aplicação desktop Electron
- [x] React + TypeScript + Vite
- [x] SQLite local
- [x] Cadastro de jogadores
- [x] Catálogo de times
- [x] Registro e edição de partidas
- [x] Ranking
- [x] Dashboard
- [x] Estatísticas
- [x] Campeonatos
- [x] Pontos corridos
- [x] Mata-mata
- [x] Fixtures
- [x] Backup e restauração
- [x] Supabase foundation
- [x] Migração de players
- [x] Migração de teams
- [x] Fluxo híbrido de matches
- [x] Scripts de teste com mock

### Em desenvolvimento

- [ ] Migração completa de championships
- [ ] Migração completa de fixtures
- [ ] Sincronização remota completa
- [ ] Implementação completa de `groups_knockout`
- [ ] Configuração do Supabase pela interface
- [ ] Armazenamento seguro de credenciais em produção
- [ ] Sistema de atualização do aplicativo
- [ ] Melhorias nos modos especiais
- [ ] Distribuição para usuários externos

---

## Boas práticas para manutenção

### Não substituir arquivos inteiros sem verificar dependências

Arquivos centrais:

```text
src/main/repository.ts
src/main/index.ts
src/main/supabase.ts
src/main/players-service.ts
src/main/teams-service.ts
src/main/matches-service.ts
src/main/championship-service.ts
src/preload/index.ts
src/shared/api.ts
src/shared/models.ts
```

Alterações nesses arquivos devem preservar os contratos existentes.

### Preservar o contrato IPC

O fluxo esperado é:

```text
Renderer
   ↓
shared/api.ts
   ↓
preload
   ↓
ipcMain
   ↓
service/repository
   ↓
SQLite / Supabase
```

### Preservar IDs durante migrações

Quando uma entidade é espelhada:

```text
SQLite ID = Supabase ID
```

Isso evita quebrar chaves estrangeiras e relacionamentos existentes.

### Validar antes de testar

```bash
npm run typecheck
npm run build
```

### Separar responsabilidades

```text
src/renderer → interface
src/preload  → ponte segura
src/main     → Electron, banco e serviços
src/shared   → contratos e tipos
scripts      → migrações e testes
supabase     → schema e configuração remota
```

## Solução de problemas

### Electron abriu uma versão antiga do código

Execute:

```bash
npx tsc -p tsconfig.electron.json
npm run dev
```

O script `npm run dev` também compila o Main antes de iniciar o Electron.

### Supabase não configurado

Isso é permitido. Sem as variáveis necessárias no `.env`, o aplicativo pode operar em modo SQLite local.

### Credenciais do Supabase inválidas

Confira:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_APP_EMAIL=
SUPABASE_APP_PASSWORD=
```

Confirme também se a conta existe em **Authentication → Users**, está confirmada e possui perfil com papel adequado.

### Erro de RLS

Verifique se o usuário autenticado possui o papel esperado em `public.profiles`.

Para uma conta administrativa:

```sql
select
  u.email,
  p.role
from public.profiles p
join auth.users u on u.id = p.id;
```

### Jogadores ou times não aparecem no Supabase

Execute novamente o script correspondente:

```bash
npm run migrate:players
npm run migrate:teams
```

Os scripts preservam os IDs locais.

### Erro de FK ao migrar partidas

A migração de `matches` depende de jogadores e times já existentes no Supabase.

Ordem recomendada:

```bash
npm run migrate:players
npm run migrate:teams
npm run migrate:matches
```

### Conflito de ID após migração

Os scripts de migração exibem um comando `setval` ao final. Execute o comando indicado no SQL Editor do Supabase para alinhar a sequência PostgreSQL aos IDs já migrados.

### Partidas perderam o vínculo de campeonato no Supabase

Durante a Etapa 4, isso pode ser esperado.

Enquanto `championships` e `fixtures` ainda dependem do SQLite, a migração histórica de `matches` pode manter `championship_id = NULL` no Supabase para evitar violação da FK remota.

O vínculo original continua preservado no SQLite e poderá ser associado remotamente quando a migração de championships for concluída.

### `npm run migrate` não funciona

O `package.json` ainda possui uma entrada legada apontando para:

```text
scripts/migrate-to-supabase.mjs
```

Esse arquivo não está presente na estrutura atual.

Use os comandos específicos:

```bash
npm run migrate:players
npm run migrate:teams
npm run migrate:matches
npm run migrate:champions
```

### `test:stage4` não existe como comando npm

O executor existe em:

```text
scripts/dev-tests/run-stage4-tests.cjs
```

Execute diretamente:

```bash
node scripts/dev-tests/run-stage4-tests.cjs
```

## Licença

Este projeto não possui licença open source definida. Todos os direitos sobre o código permanecem com o autor enquanto uma licença não for adicionada ao repositório.

---

## Repositório

[GitHub — victorhenrique121/campeonatin](https://github.com/victorhenrique121/campeonatin)
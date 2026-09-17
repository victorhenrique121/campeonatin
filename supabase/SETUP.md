# FC Arena — Setup do Supabase (Etapas 1–4)

Guia único para deixar um projeto Supabase pronto para o FC Arena.
Nenhuma etapa aqui cria tabelas por código do aplicativo: tudo é aplicado
manualmente por você no Supabase (SQL Editor / Dashboard).

## 1. Aplicar o schema (migration inicial)

No **SQL Editor** do seu projeto Supabase, execute integralmente o conteúdo de:

```text
supabase/migrations/20260827160000_initial_schema.sql
```

Isso cria `profiles`, `players`, `teams`, `championships`, `matches`,
`fixtures`, funções, triggers de Auth e as políticas de **RLS**.

> A migração avança por entidade: `players` usa o remoto como fonte de
> verdade (Etapa 2); `teams` é lido do remoto, com escrita manual via script
> (Etapa 3); `matches` é escrito no remoto pelo app, com leitura sempre local
> (Etapa 4). `championships/fixtures` seguem 100% no SQLite até a Etapa 5.

---

## 2. Criar a conta de serviço do aplicativo

O app desktop não usa `service_role` (ela **nunca** deve existir no app).
Em vez disso, usa uma conta de usuário comum do **Supabase Auth**:

1. Dashboard → **Authentication → Users → Add user**.
2. Defina um e-mail (ex.: `app-servico@seudominio.local`) e uma senha forte.
3. Marque o e-mail como confirmado (a conta de serviço não fará verificação
   por link).

---

## 3. Promover a conta de serviço a `admin` (uma única vez)

O trigger `on_auth_user_created` cria automaticamente um `profiles` com papel
`viewer`. Como o RLS exige papel `admin` para **inserir/atualizar/excluir**
players, promova a conta no **SQL Editor**:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where email = 'app-servico@seudominio.local'
);
```

Confirme com:

```sql
select
  u.email,
  p.role
from public.profiles p
join auth.users u on u.id = p.id;
```

O resultado esperado para a conta de serviço é:

```text
app-servico@seudominio.local | admin
```

---

## 4. Configurar o `.env` local

Copie `.env.example` para `.env` na raiz do projeto e preencha:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=<chave pública anon>
SUPABASE_APP_EMAIL=app-servico@seudominio.local
SUPABASE_APP_PASSWORD=<senha da conta de serviço>
```

O `.env` está no `.gitignore` — **nunca** commite esse arquivo.

Essas variáveis são lidas apenas no processo **main** do Electron; nada deve
ser exposto ao renderer.

> **Importante:** `SUPABASE_ANON_KEY` é uma chave pública e depende das
> políticas de RLS para segurança. A `service_role` possui privilégios
> elevados e **não deve ser colocada no `.env` utilizado pelo aplicativo**.

---

## 5. (Etapa 2) Migrar jogadores existentes do SQLite

Se você já tem jogadores cadastrados no app:

```bash
npm run migrate:players
```

Ou apontando o banco explicitamente:

```bash
npm run migrate:players -- "C:/caminho/para/fc-arena.sqlite"
```

O script insere os jogadores no Supabase **preservando os IDs locais**.

Isso é importante porque os IDs continuam sendo utilizados pelos
relacionamentos existentes no SQLite, incluindo partidas, fixtures e ranking.

Ao final, rode no **SQL Editor** o comando impresso pelo script para ajustar a
sequência de IDs:

```sql
select setval(
  pg_get_serial_sequence('public.players', 'id'),
  (select coalesce(max(id), 1) from public.players)
);
```

### Comportamento da Etapa 2

Depois da migração:

* leitura de jogadores pode utilizar o Supabase;
* o SQLite continua sendo mantido como espelho local;
* novos jogadores são enviados ao Supabase;
* alterações/exclusões são realizadas no remoto antes de atualizar o espelho;
* se o Supabase não estiver disponível, o comportamento de fallback local deve
  seguir a implementação existente do aplicativo.

---

## 6. (Etapa 3) Migrar o catálogo de times para o Supabase

A tabela remota `public.teams` nasce **vazia** (a migration não semeia dados)
e o aplicativo **não escreve nela automaticamente** — o catálogo é global e
estático, sob controle manual.

Depois de promover a conta de serviço a `admin` (passo 3), rode:

```bash
npm run migrate:teams
```

Ou apontando o banco explicitamente:

```bash
npm run migrate:teams -- "C:/caminho/para/fc-arena.sqlite"
```

O script faz upsert do catálogo local (os ~660 clubes do seed)
**preservando os IDs** — essencial para as FKs
`matches.team1_id/team2_id`, que continuam no SQLite.

A migração é idempotente: pode ser executada novamente quando
`clubRows.ts` for atualizado com novos clubes ou patches do jogo.

Ao final, execute no **SQL Editor** o comando impresso pelo script:

```sql
select setval(
  pg_get_serial_sequence('public.teams', 'id'),
  (select coalesce(max(id), 1) from public.teams)
);
```

Nenhuma policy nova é necessária: o RLS existente já permite leitura para
sessões `authenticated` e escrita para `admin`.

---

# 7. (Etapa 4) Migrar partidas existentes para o Supabase

A Etapa 4 introduz o Supabase para as **partidas**, mas sem migrar ainda a
responsabilidade dos campeonatos e fixtures.

Antes de executar:

```bash
npm run migrate:matches
```

certifique-se de que:

1. O schema inicial foi aplicado.
2. A conta de serviço existe.
3. A conta de serviço possui papel `admin`.
4. O `.env` está configurado.
5. Jogadores e times já foram migrados.
6. O banco SQLite que contém as partidas está acessível.

Execute:

```bash
npm run migrate:matches
```

Ou:

```bash
npm run migrate:matches -- "C:/caminho/para/fc-arena.sqlite"
```

O script lê as partidas existentes no SQLite e faz a migração para
`public.matches`, preservando os IDs locais.

### Particularidade do `championship_id`

Na Etapa 4, as partidas remotas são gravadas com:

```text
championship_id = NULL
```

Isso é **intencional**.

Os campeonatos e seus relacionamentos continuam sendo responsabilidade do
SQLite nesta etapa. Portanto, não se deve tentar reconstruir ou substituir
esses relacionamentos no Supabase ainda.

O `championshipId` existente no SQLite continua preservado localmente.

Ao final da migração, ajuste a sequência:

```sql
select setval(
  pg_get_serial_sequence('public.matches', 'id'),
  (select coalesce(max(id), 1) from public.matches)
);
```

---

# 8. Arquitetura da Etapa 4

A Etapa 4 utiliza uma arquitetura híbrida.

### Escritas

Operações de escrita de partidas seguem:

```text
Renderer
   ↓
IPC
   ↓
matches-service
   ↓
Supabase
   ↓
SQLite local
```

Ou seja, quando o Supabase está configurado e autenticado:

1. a operação é enviada ao Supabase;
2. o Supabase confirma a operação;
3. o registro local é atualizado utilizando o mesmo ID remoto.

Isso mantém os dois lados alinhados.

### Leituras

A listagem das partidas continua sendo feita pelo SQLite:

```text
Renderer
   ↓
IPC
   ↓
SQLite
   ↓
matches:list
```

Isso ocorre porque o SQLite ainda mantém informações locais que não foram
migradas para o Supabase, principalmente os relacionamentos com
`championships`.

### Resumo

| Entidade      | Fonte principal       | Espelho local       | Escrita remota    |
| ------------- | --------------------- | ------------------- | ----------------- |
| Players       | Supabase              | SQLite              | Automática        |
| Teams         | Supabase              | SQLite              | Manual via script |
| Matches       | Supabase para escrita | SQLite para leitura | Automática        |
| Championships | SQLite                | —                   | Ainda não         |
| Fixtures      | SQLite                | —                   | Ainda não         |

---

# 9. Regra importante: não substituir a arquitetura existente

A Etapa 4 **não exige uma reescrita completa do repository**.

O projeto possui uma arquitetura existente que deve ser preservada.

Antes de alterar qualquer arquivo, confirme a API real de:

```text
src/main/repository.ts
src/main/players-service.ts
src/main/teams-service.ts
src/main/matches-service.ts
src/main/supabase.ts
src/shared/models.ts
```

Não devem ser introduzidas chamadas como:

```ts
repository.initDb()
repository.getMatches()
repository.saveMatch()
```

se o `repository.ts` existente utiliza outra arquitetura, como:

```ts
const db = createDatabase(...);
const repo = repository(db);

repo.matches();
repo.updateMatch(...);
repo.deleteMatch(...);
```

A implementação da Etapa 4 deve se adaptar à arquitetura real do projeto,
e não substituir silenciosamente funções existentes.

---

# 10. Sincronização das partidas

O projeto possui uma função de sincronização do espelho local:

```text
syncMirrorMatches()
```

Essa sincronização consulta as partidas remotas e atualiza o SQLite.

Porém, existe uma regra fundamental:

> A sincronização **não pode apagar ou substituir o `championshipId`
> existente no SQLite apenas porque `championship_id` está `NULL` no Supabase.

Exemplo:

```text
SQLite:
match 10
championshipId = 42

Supabase:
match 10
championship_id = NULL
```

Depois da sincronização:

```text
SQLite:
match 10
championshipId = 42
```

O `NULL` remoto não deve destruir a informação local.

Essa regra é necessária enquanto `championships` e `fixtures` ainda permanecem
no SQLite.

---

# 11. Comportamento offline

Na Etapa 4, operações de escrita de partidas dependem do Supabase quando ele
está configurado.

Portanto, se o Supabase estiver indisponível durante uma operação que exige
escrita remota:

```text
Supabase indisponível
        ↓
operação remota falha
        ↓
SQLite não deve ser alterado parcialmente
```

Isso evita que o banco local fique diferente do banco remoto sem que o
aplicativo saiba disso.

Operações que são explicitamente locais, como a limpeza local definida pela
arquitetura da Etapa 4, continuam seguindo suas próprias regras.

---

# 12. Testes da Etapa 4

Existe um mock local do Supabase para testar o comportamento sem utilizar o
projeto real.

Os arquivos envolvidos são:

```text
scripts/dev-tests/mock-supabase.cjs
scripts/dev-tests/run-stage4-tests.cjs
```

Execute:

```bash
npm run test:stage4
```

Os testes verificam principalmente:

### Cenário 1 — modo legado/local

Verifica se o aplicativo continua funcionando quando o Supabase não está
configurado.

### Cenário 2 — escrita remota

Verifica se:

* a partida é enviada ao Supabase;
* o ID remoto é utilizado;
* `championship_id` remoto permanece `NULL`;
* `championshipId` local continua preservado.

### Cenário 3 — Supabase offline

Verifica se uma falha remota não deixa uma gravação local parcialmente
concluída.

### Cenário 4 — credenciais ausentes

Verifica o comportamento quando a senha da conta de serviço não está
configurada.

### Cenário 5 — sincronização

Verifica se:

```text
SQLite championshipId = 42
Supabase championship_id = NULL
```

continua resultando em:

```text
SQLite championshipId = 42
```

após a sincronização.

---

# 13. Typecheck antes de executar

Antes de testar o aplicativo:

```bash
npm run typecheck
```

Esse comando verifica o TypeScript do projeto e do processo Electron.

Se houver erros, **não ignore os erros para continuar a migração**.

Em especial, verifique se alguma alteração introduziu:

* funções inexistentes;
* imports incorretos;
* diferenças entre `snake_case` e `camelCase`;
* tipos incompatíveis;
* IDs `number` vs `string`;
* funções duplicadas;
* APIs antigas sendo chamadas por arquivos novos.

---

# 14. Build

Depois que o typecheck passar:

```bash
npm run build
```

O build deve terminar sem erros.

Se a Etapa 4 alterar arquivos do processo Electron, confirme especialmente
se os arquivos compilados aparecem em:

```text
dist-electron/
```

---

# 15. Checklist completo de instalação

Use esta ordem para configurar uma instalação nova.

### Supabase

* [ ] Criar projeto no Supabase.
* [ ] Executar `20260827160000_initial_schema.sql`.
* [ ] Confirmar criação das tabelas.
* [ ] Confirmar criação das policies RLS.
* [ ] Criar usuário da conta de serviço.
* [ ] Confirmar e-mail do usuário.
* [ ] Promover o usuário para `admin`.

### Projeto local

* [ ] Criar `.env`.
* [ ] Configurar `SUPABASE_URL`.
* [ ] Configurar `SUPABASE_ANON_KEY`.
* [ ] Configurar `SUPABASE_APP_EMAIL`.
* [ ] Configurar `SUPABASE_APP_PASSWORD`.
* [ ] Confirmar que `.env` está no `.gitignore`.

### Etapa 2

* [ ] Executar `npm run migrate:players`.
* [ ] Ajustar sequência de `players`.
* [ ] Confirmar jogadores no Supabase.
* [ ] Testar leitura pelo aplicativo.

### Etapa 3

* [ ] Executar `npm run migrate:teams`.
* [ ] Ajustar sequência de `teams`.
* [ ] Confirmar catálogo no Supabase.
* [ ] Testar leitura dos times pelo aplicativo.

### Etapa 4

* [ ] Executar `npm run migrate:matches`.
* [ ] Ajustar sequência de `matches`.
* [ ] Confirmar partidas no Supabase.
* [ ] Confirmar `championship_id = NULL` no remoto.
* [ ] Confirmar que `championshipId` continua correto no SQLite.
* [ ] Executar `npm run test:stage4`.
* [ ] Executar `npm run typecheck`.
* [ ] Executar `npm run build`.
* [ ] Abrir o aplicativo e testar criação de partida.
* [ ] Testar edição de resultado.
* [ ] Testar exclusão de partida.
* [ ] Testar listagem.
* [ ] Testar ranking.
* [ ] Testar campeonatos.

---

# 16. Troubleshooting

## "Missing Supabase environment variables"

Verifique se o `.env` está na **raiz do projeto**:

```text
FC-Arena/
├── .env
├── package.json
├── src/
├── scripts/
└── supabase/
```

Confirme também se as variáveis possuem exatamente estes nomes:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_APP_EMAIL=
SUPABASE_APP_PASSWORD=
```

---

## "Invalid login credentials"

Confirme:

* e-mail da conta de serviço;
* senha;
* usuário existente em Authentication → Users;
* e-mail confirmado;
* valores carregados pelo processo main.

Não utilize a `service_role` como senha ou como `SUPABASE_ANON_KEY`.

---

## "permission denied" / erro de RLS

Verifique se a conta utilizada pelo aplicativo possui:

```text
profiles.role = admin
```

Execute:

```sql
select
  u.email,
  p.role
from public.profiles p
join auth.users u on u.id = p.id;
```

Se a conta estiver como `viewer`, execute novamente a promoção para `admin`.

---

## Jogadores aparecem no SQLite mas não no Supabase

Execute novamente:

```bash
npm run migrate:players
```

Depois confirme diretamente:

```sql
select *
from public.players
order by id;
```

---

## Times aparecem localmente mas não remotamente

Execute:

```bash
npm run migrate:teams
```

Depois confirme:

```sql
select count(*)
from public.teams;
```

---

## Partida foi salva localmente mas não remotamente

Verifique:

1. configuração do `.env`;
2. autenticação da conta de serviço;
3. papel `admin`;
4. RLS da tabela `matches`;
5. conexão com o Supabase;
6. logs do processo main.

A Etapa 4 não deve considerar uma operação concluída quando a escrita remota
obrigatória falhou.

---

## `championshipId` desapareceu depois da sincronização

Isso indica uma violação da regra da Etapa 4.

O Supabase mantém:

```text
championship_id = NULL
```

enquanto os campeonatos ainda estão no SQLite.

A sincronização deve preservar o valor existente no SQLite quando o valor
remoto for `NULL`.

---

# 17. Segurança

Nunca coloque no renderer:

```text
SUPABASE_APP_PASSWORD
```

ou qualquer credencial privilegiada.

Nunca coloque uma `service_role` no código distribuído do aplicativo.

O renderer deve conversar com o processo main por IPC, e o processo main é
responsável pela comunicação com o Supabase.

O arquivo:

```text
.env
```

também não deve ser versionado.

Antes de fazer commit, confirme:

```bash
git status
```

e:

```bash
git check-ignore .env
```

O segundo comando deve indicar que `.env` está sendo ignorado.

---

# 18. Estado atual da migração

Após concluir as Etapas 1–4, a arquitetura esperada é:

```text
                    ┌─────────────────┐
                    │   FC Arena      │
                    │    Electron     │
                    └────────┬────────┘
                             │
                           IPC
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
        ┌───────────┐                 ┌────────────┐
        │  SQLite   │                 │ Supabase   │
        │   local   │◄──── espelho ──►│  remoto    │
        └───────────┘                 └────────────┘
```

### Players

```text
Supabase = fonte principal
SQLite   = espelho
```

### Teams

```text
Supabase = catálogo remoto
SQLite   = catálogo local
migração = manual
```

### Matches

```text
Supabase = destino das escritas
SQLite   = fonte das leituras atuais
```

### Championships

```text
SQLite = fonte principal
Supabase = ainda não migrado
```

### Fixtures

```text
SQLite = fonte principal
Supabase = ainda não migrado
```

---

# 19. Próxima etapa

A **Etapa 5** deverá tratar a migração de `championships` e,
posteriormente, `fixtures`.

Ela não deve ser iniciada simplesmente adicionando campos ao fluxo atual.

Antes disso, será necessário definir:

* relacionamento entre championships e matches;
* relacionamento entre championships e fixtures;
* origem dos IDs;
* sincronização dos registros;
* comportamento offline;
* RLS;
* ordem de migração;
* preservação do histórico existente;
* estratégia para evitar duplicação;
* qual banco será a fonte de verdade;
* como o ranking será calculado depois da migração.

Até a conclusão dessa etapa, **não altere a regra da Etapa 4 de manter os
relacionamentos de campeonato no SQLite**.

---

# 20. Comandos principais

```bash
# Desenvolvimento
npm run dev

# Verificação TypeScript
npm run typecheck

# Build
npm run build

# Testes da Etapa 2
npm run test:stage2

# Testes da Etapa 4
npm run test:stage4

# Migração de jogadores
npm run migrate:players

# Migração de times
npm run migrate:teams

# Migração de partidas
npm run migrate:matches
```

---

# 21. (UX) Colunas `mode`/`mutator` em `public.championships` — opcional

A diferenciação visual dos modos de campeonato (Clássico / Dupla 2v2 /
Maluco + desafio sorteado) passou a persistir `mode` e `mutator` no
**SQLite**. A migração local é automática e guardada no boot
(`PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN`, default
`'classic'`) — não há nada a fazer localmente, nem em bancos antigos.

No **Supabase**, `public.championships` continua sem uso pelo aplicativo
(a migração de championships é a próxima etapa, conforme a seção 19).
Para manter o schema remoto alinhado com o local desde já, aplique no
**SQL Editor** a migration
`supabase/migrations/20260917120000_add_championship_mode.sql`
(idempotente; inofensiva com a tabela vazia; não altera RLS). Se
preferir, aplique junto da etapa de championships — o app não lê nem
escreve championships remotamente nesta fase.

---

## Regra principal deste README

A migração é **incremental**.

Cada etapa deve adicionar uma responsabilidade ao Supabase sem destruir as
funcionalidades que continuam dependentes do SQLite.

Portanto:

> **Não substituir arquivos inteiros, não remover IPCs existentes e não
> alterar contratos de funções sem primeiro verificar a arquitetura atual do
> projeto.**

Qualquer nova etapa deve preservar as funcionalidades já existentes e ser
implementada de forma compatível com as etapas anteriores.
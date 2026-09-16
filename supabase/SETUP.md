# FC Arena — Setup do Supabase (Etapas 1–2)

Guia único para deixar um projeto Supabase pronto para o FC Arena.
Nenhuma etapa aqui cria tabelas por código do aplicativo: tudo é aplicado
manualmente por você no Supabase (SQL Editor / Dashboard).

## 1. Aplicar o schema (migration inicial)

No **SQL Editor** do seu projeto Supabase, execute integralmente o conteúdo de:

```
supabase/migrations/20260827160000_initial_schema.sql
```

Isso cria `profiles`, `players`, `teams`, `championships`, `matches`,
`fixtures`, funções, triggers de Auth e as políticas de **RLS**.

> Ainda não usamos `teams/championships/matches/fixtures` remotos — nesta
> etapa só `players` migra. O restante continua 100% no SQLite local.

## 2. Criar a conta de serviço do aplicativo

O app desktop não usa `service_role` (ela **nunca** deve existir no app).
Em vez disso, usa uma conta de usuário comum do **Supabase Auth**:

1. Dashboard → **Authentication → Users → Add user**.
2. Defina um e-mail (ex.: `app-servico@seudominio.local`) e uma senha forte.
3. Marque o e-mail como confirmado (a conta de serviço não fará verificação
   por link).

## 3. Promover a conta de serviço a `admin` (uma única vez)

O trigger `on_auth_user_created` cria automaticamente um `profiles` com papel
`viewer`. Como o RLS exige papel `admin` para **inserir/atualizar/excluir**
players, promova a conta no **SQL Editor**:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'app-servico@seudominio.local');
```

(confirme com: `select p.role from public.profiles p join auth.users u on u.id = p.id;`)

## 4. Configurar o `.env` local

Copie `.env.example` para `.env` na raiz do projeto e preencha:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=<chave pública anon>
SUPABASE_APP_EMAIL=app-servico@seudominio.local
SUPABASE_APP_PASSWORD=<senha da conta de serviço>
```

O `.env` está no `.gitignore` — **nunca** commite. Essas variáveis são lidas
apenas no processo **main** do Electron; nada vaza para o renderer.

## 5. (Opcional) Migrar jogadores existentes do SQLite

Se você já tem jogadores cadastrados no app:

```bash
npm run migrate:players
# ou apontando o banco explicitamente:
npm run migrate:players -- "C:/caminho/para/fc-arena.sqlite"
```

O script insere no Supabase **preservando os ids locais** (para não quebrar
matches/fixtures/ranking que seguem no SQLite). Ao final, rode no **SQL
Editor** o comando impresso pelo script (ajuste da sequência de ids):

```sql
select setval(
  pg_get_serial_sequence('public.players', 'id'),
  (select coalesce(max(id), 1) from public.players)
);
```

## 6. Validar

```bash
npm run dev
```

No console do processo main você deve ver, nesta ordem:

```
[supabase] cliente criado para https://... (chave anon pública).
[supabase] Login da conta de serviço realizado (...).
[supabase] Teste de conexão (connected): Conexão ... autenticada como ...
[players] espelho local sincronizado com o Supabase: N jogador(es).
```

## Solução de problemas (mensagens no console)

| Status/mensagem | Causa provável | Correção |
|---|---|---|
| `not-configured` | `.env` ausente/incompleto | Passo 4 (app segue 100% SQLite, como antes) |
| `table-missing` (PGRST205) | Migration não aplicada | Passo 1 |
| `invalid-credentials` | Senha/e-mail da conta de serviço errados, ou usuário sem e-mail confirmado | Passos 2 e 4 |
| `unreachable` | Sem internet / `SUPABASE_URL` errada | Verificar rede e URL |
| `Permissão negada (RLS)` ao salvar players | Profile da conta não é `admin` | Passo 3 |
| `Já existe um jogador com esse apelido` | UNIQUE em `nickname` | Usar outro apelido |

## Segurança (resumo)

- Chave **anon** é pública por design; quem protege os dados é o **RLS**.
- Conta de serviço: credenciais ficam só no `.env` local; a sessão persiste em
  `userData/supabase-session.json` na máquina do usuário.
- `SUPABASE_SERVICE_ROLE_KEY` **nunca** é lida/usada; se estiver no ambiente,
  o app apenas alerta para removê-la.

#!/usr/bin/env node
/**
 * ============================================================================
 * ETAPA 2 — Migração única de dados: players (SQLite local -> Supabase)
 * ============================================================================
 * Uso:
 *   npm run migrate:players                        # usa o banco padrão do app
 *   npm run migrate:players -- caminho/fc-arena.sqlite
 *
 * O que faz:
 *   1. Carrega o .env da raiz do projeto (SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_APP_EMAIL, SUPABASE_APP_PASSWORD).
 *   2. Abre o SQLite local (somente leitura) e lê a tabela players.
 *   3. Faz login com a conta de serviço (RLS exige sessão 'authenticated' e
 *      profile 'admin' para inserir).
 *   4. Insere/atualiza no Supabase PRESERVANDO OS IDS locais (upsert on id),
 *      para não quebrar matches/fixtures/ranking que continuam no SQLite.
 *   5. Imprime o comando SQL (setval) que você DEVE rodar uma vez no SQL
 *      Editor para a sequência de ids não colidir com os ids migrados.
 *
 * Nada aqui usa SUPABASE_SERVICE_ROLE_KEY. Nenhuma tabela é criada por código:
 * aplique antes a migration supabase/migrations/20260827160000_initial_schema.sql.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";

// --- .env da raiz do projeto (mesmo mecanismo do processo main) -------------
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* sem .env — as variáveis podem vir do próprio ambiente */
}

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const APP_EMAIL = (process.env.SUPABASE_APP_EMAIL || "").trim();
const APP_PASSWORD = process.env.SUPABASE_APP_PASSWORD || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !APP_EMAIL || !APP_PASSWORD) {
  console.error(
    "ERRO: defina SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_APP_EMAIL e SUPABASE_APP_PASSWORD no .env (veja .env.example).",
  );
  process.exit(1);
}

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "AVISO: SUPABASE_SERVICE_ROLE_KEY detectada no ambiente. Este script NÃO a utiliza — remova-a do .env por segurança.",
  );
}

// --- Banco SQLite local (padrão: pasta userData do Electron por SO) ---------
function defaultDbPath() {
  const dir =
    process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "fc-arena")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "fc-arena")
        : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "fc-arena");
  return path.join(dir, "fc-arena.sqlite");
}

const dbPath = process.argv[2] || defaultDbPath();
if (!fs.existsSync(dbPath)) {
  console.error(`ERRO: banco SQLite não encontrado em: ${dbPath}`);
  console.error("Passe o caminho como argumento: npm run migrate:players -- /caminho/fc-arena.sqlite");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const localPlayers = db
  .prepare("SELECT id,name,nickname,avatar,created_at FROM players ORDER BY id")
  .all();
db.close();

console.log(`SQLite: ${dbPath}`);
console.log(`Jogadores locais encontrados: ${localPlayers.length}`);

if (localPlayers.length === 0) {
  console.log("Nada a migrar. Supabase pode começar vazio (a sequência de ids não precisa de ajuste).");
  process.exit(0);
}

// --- Supabase: login da conta de serviço + upsert preservando ids -----------
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error: authError } = await supabase.auth.signInWithPassword({
  email: APP_EMAIL,
  password: APP_PASSWORD,
});
if (authError) {
  console.error(`ERRO: login da conta de serviço falhou: ${authError.message}`);
  console.error("Verifique SUPABASE_APP_EMAIL/SUPABASE_APP_PASSWORD e se o usuário tem e-mail confirmado.");
  process.exit(1);
}
console.log(`Login OK como ${APP_EMAIL}.`);

const payload = localPlayers.map((row) => ({
  id: row.id,
  name: row.name,
  nickname: row.nickname,
  avatar: row.avatar ?? null,
  created_at: row.created_at,
}));

// Tentativa em lote (upsert on id). Se algo conflitar, refaz linha a linha
// para reportar exatamente quais falharam.
const { data: batchData, error: batchError } = await supabase
  .from("players")
  .upsert(payload, { upsertOn: "id" })
  .select("id,name,nickname");

let okCount = 0;
const failures = [];

if (!batchError) {
  okCount = (batchData || []).length;
} else {
  console.warn(`Upsert em lote falhou (${batchError.code || "n/d"}: ${batchError.message}). Tentando linha a linha...`);
  for (const row of payload) {
    const { error } = await supabase.from("players").upsert(row, { upsertOn: "id" }).select("id");
    if (error) {
      failures.push({ id: row.id, nickname: row.nickname, code: error.code, message: error.message });
    } else {
      okCount += 1;
    }
  }
}

console.log(`\nResultado: ${okCount} migrado(s)/atualizado(s), ${failures.length} falha(s).`);
for (const fail of failures) {
  console.error(`  - id=${fail.id} nickname="${fail.nickname}" [${fail.code || "n/d"}] ${fail.message}`);
}

const maxId = localPlayers.reduce((max, row) => Math.max(max, Number(row.id)), 0);

console.log(`
────────────────────────────────────────────────────────────────────────────
PRÓXIMO PASSO OBRIGATÓRIO (uma única vez, no SQL Editor do Supabase):
ajuste a sequência de ids para que novos jogadores não colidam com os migrados:

  select setval(
    pg_get_serial_sequence('public.players', 'id'),
    (select coalesce(max(id), 1) from public.players)
  );

(maior id migrado: ${maxId})

Lembrete: a conta de serviço precisa ter profile com papel 'admin' — veja
supabase/SETUP.md. Nada neste script cria tabelas ou altera o schema.
────────────────────────────────────────────────────────────────────────────`);

process.exit(failures.length > 0 ? 2 : 0);

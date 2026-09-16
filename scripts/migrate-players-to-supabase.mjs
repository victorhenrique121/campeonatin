#!/usr/bin/env node
/**
 * ============================================================================
 * ETAPA 3 — Migração manual do catálogo: teams (SQLite local -> Supabase)
 * ============================================================================
 * Uso:
 *   npm run migrate:teams                        # usa o banco padrão do app
 *   npm run migrate:teams -- caminho/fc-arena.sqlite
 *
 * Decisão de projeto (aprovada): o aplicativo NÃO semeia/atualiza o remoto
 * automaticamente. Este script é o ÚNICO caminho de escrita do catálogo no
 * Supabase — rode-o uma vez após configurar o projeto e novamente sempre que
 * o clubRows.ts for atualizado (novos patches do jogo).
 *
 * O que faz:
 *   1. Carrega o .env da raiz do projeto (SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_APP_EMAIL, SUPABASE_APP_PASSWORD — a mesma conta de serviço
 *      admin da Etapa 2; RLS de teams já a cobre, sem policies novas).
 *   2. Abre o SQLite local (somente leitura) e lê a tabela teams.
 *   3. Faz login com a conta de serviço.
 *   4. Insere/atualiza no Supabase PRESERVANDO OS IDS locais (upsert on id,
 *      idempotente), para não quebrar as FKs de matches (team1_id/team2_id)
 *      e os JOINs de nomes, que continuam 100% SQLite.
 *   5. Imprime o comando SQL (setval) que você DEVE rodar uma vez no SQL
 *      Editor para a sequência de ids não colidir com os ids migrados.
 *
 * Nada aqui usa SUPABASE_SERVICE_ROLE_KEY. Nenhuma tabela é criada por código:
 * é pré-requisito ter aplicado supabase/migrations/20260827160000_initial_schema.sql.
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
  console.error("Passe o caminho como argumento: npm run migrate:teams -- /caminho/fc-arena.sqlite");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const localTeams = db
  .prepare("SELECT id,name,league,country FROM teams ORDER BY id")
  .all();
db.close();

console.log(`SQLite: ${dbPath}`);
console.log(`Times locais encontrados: ${localTeams.length}`);

if (localTeams.length === 0) {
  console.log("Nada a migrar (catálogo local vazio — situação inesperada, pois o seed do app popula teams).");
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

const payload = localTeams.map((row) => ({
  id: row.id,
  name: row.name,
  league: row.league,
  country: row.country,
}));

// Tentativa em lote (upsert on id). Se algo conflitar, refaz linha a linha
// para reportar exatamente quais falharam.
const { data: batchData, error: batchError } = await supabase
  .from("teams")
  .upsert(payload, { upsertOn: "id" })
  .select("id,name");

let okCount = 0;
const failures = [];

if (!batchError) {
  okCount = (batchData || []).length;
} else {
  console.warn(`Upsert em lote falhou (${batchError.code || "n/d"}: ${batchError.message}). Tentando linha a linha...`);
  for (const row of payload) {
    const { error } = await supabase.from("teams").upsert(row, { upsertOn: "id" }).select("id");
    if (error) {
      failures.push({ id: row.id, name: row.name, code: error.code, message: error.message });
    } else {
      okCount += 1;
    }
  }
}

console.log(`\nResultado: ${okCount} migrado(s)/atualizado(s), ${failures.length} falha(s).`);
for (const fail of failures) {
  console.error(`  - id=${fail.id} name="${fail.name}" [${fail.code || "n/d"}] ${fail.message}`);
}

const maxId = localTeams.reduce((max, row) => Math.max(max, Number(row.id)), 0);

console.log(`
────────────────────────────────────────────────────────────────────────────
PRÓXIMO PASSO OBRIGATÓRIO (uma única vez, no SQL Editor do Supabase):
ajuste a sequência de ids para que novos times não colidam com os migrados:

  select setval(
    pg_get_serial_sequence('public.teams', 'id'),
    (select coalesce(max(id), 1) from public.teams)
  );

(maior id migrado: ${maxId})

Lembrete: o aplicativo NUNCA escreve no remoto para teams — rode este script
novamente sempre que o catálogo (clubRows.ts) for atualizado. A conta de
serviço precisa ter profile com papel 'admin' (veja supabase/SETUP.md).
Nada neste script cria tabelas ou altera o schema.
────────────────────────────────────────────────────────────────────────────`);

process.exit(failures.length > 0 ? 2 : 0);
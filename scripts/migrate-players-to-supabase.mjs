#!/usr/bin/env node
/**
 * ============================================================================
 * Migração manual do histórico: players (SQLite local -> Supabase)
 * ============================================================================
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";

// --- .env da raiz do projeto ---
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* sem .env */
}

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const APP_EMAIL = (process.env.SUPABASE_APP_EMAIL || "").trim();
const APP_PASSWORD = process.env.SUPABASE_APP_PASSWORD || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !APP_EMAIL || !APP_PASSWORD) {
  console.error(
    "ERRO: defina SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_APP_EMAIL e SUPABASE_APP_PASSWORD no .env.",
  );
  process.exit(1);
}

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "AVISO: SUPABASE_SERVICE_ROLE_KEY detectada no ambiente. Este script NÃO a utiliza — remova-a do .env por segurança.",
  );
}

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
  .prepare(
    `SELECT id, name, nickname, avatar_url, active, created_at
     FROM players ORDER BY id`,
  )
  .all();
db.close();

console.log(`SQLite: ${dbPath}`);
console.log(`Jogadores locais encontrados: ${localPlayers.length}`);

if (localPlayers.length === 0) {
  console.log("Nada a migrar (nenhum jogador no banco local).");
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: APP_EMAIL,
  password: APP_PASSWORD,
});
if (authError) {
  console.error(`ERRO: login da conta de serviço falhou: ${authError.message}`);
  process.exit(1);
}

const createdBy = authData?.user?.id || authData?.session?.user?.id;
if (!createdBy) {
  console.error("ERRO: login OK, mas o Supabase não retornou o uuid do usuário (created_by).");
  process.exit(1);
}
console.log(`Login OK como ${APP_EMAIL} (created_by=${createdBy}).`);

const payload = localPlayers.map((row) => ({
  id: row.id,
  name: row.name,
  nickname: row.nickname || null,
  avatar_url: row.avatar_url || null,
  active: row.active === 1 || row.active === true,
  created_at: row.created_at || new Date().toISOString(),
  created_by: createdBy,
}));

const { data: batchData, error: batchError } = await supabase
  .from("players")
  .upsert(payload, { onConflict: "id" })
  .select("id");

let okCount = 0;
const failures = [];

if (!batchError) {
  okCount = (batchData || []).length;
} else {
  console.warn(`Upsert em lote falhou (${batchError.code || "n/d"}: ${batchError.message}). Tentando linha a linha...`);
  for (const row of payload) {
    const { error } = await supabase.from("players").upsert(row, { onConflict: "id" }).select("id");
    if (error) {
      failures.push({ id: row.id, code: error.code, message: error.message });
    } else {
      okCount += 1;
    }
  }
}

console.log(`\nResultado: ${okCount} migrado(s)/atualizado(s), ${failures.length} falha(s).`);
for (const fail of failures) {
  console.error(`  - id=${fail.id} [${fail.code || "n/d"}] ${fail.message}`);
}

const maxId = localPlayers.reduce((max, row) => Math.max(max, Number(row.id)), 0);

console.log(`
────────────────────────────────────────────────────────────────────────────
PRÓXIMO PASSO OBRIGATÓRIO (uma única vez, no SQL Editor do Supabase):
ajuste a sequência de ids para que novos registros não colidam com os migrados:

  select setval(
    pg_get_serial_sequence('public.players', 'id'),
    (select coalesce(max(id), 1) from public.players)
  );

(maior id migrado: ${maxId})
────────────────────────────────────────────────────────────────────────────`);

process.exitCode = failures.length > 0 ? 2 : 0;
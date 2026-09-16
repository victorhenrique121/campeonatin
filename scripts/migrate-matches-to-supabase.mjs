#!/usr/bin/env node
/**
 * ============================================================================
 * ETAPA 4 — Migração manual do histórico: matches (SQLite local -> Supabase)
 * ============================================================================
 * Uso:
 *   npm run migrate:matches                        # usa o banco padrão do app
 *   npm run migrate:matches -- caminho/fc-arena.sqlite
 *
 * Por que rodar (decisões aprovadas da Etapa 4):
 *   - O app passa a ESCREVER partidas no Supabase automaticamente (padrão
 *     híbrido), mas o histórico ANTIGO só existe no SQLite. Este script o
 *     leva para o remoto PRESERVANDO OS IDS (upsert on id, idempotente),
 *     alinhando também a sequência (setval) para os ids gerados pelo
 *     Supabase nunca colidirem com o histórico migrado.
 *
 * O que faz:
 *   1. Carrega o .env da raiz do projeto (SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SUPABASE_APP_EMAIL, SUPABASE_APP_PASSWORD — a mesma conta de serviço
 *      admin da Etapa 2; o RLS de matches já a cobre, sem policies novas).
 *   2. Abre o SQLite local (somente leitura) e lê a tabela matches.
 *   3. Faz login com a conta de serviço e usa o uuid dela como created_by
 *      (coluna NOT NULL remota que não existe local).
 *   4. Faz upsert no Supabase preservando os ids locais. championship_id é
 *      SEMPRE enviado como NULL: public.championships está vazia até a
 *      Etapa 5 (FK quebraria). O vínculo real continua no SQLite e poderá
 *      ser backfillado por SQL na Etapa 5, pois os ids são preservados.
 *   5. Imprime o comando SQL (setval) que você DEVE rodar uma vez no SQL
 *      Editor para a sequência de ids não colidir com os ids migrados.
 *
 * PRÉ-REQUISITOS: migration inicial aplicada (passo 1 do SETUP.md) e
 * `npm run migrate:players` + `npm run migrate:teams` já executados — as FKs
 * remotas de matches apontam para public.players e public.teams (23503 se
 * faltarem linhas).
 *
 * Nada aqui usa SUPABASE_SERVICE_ROLE_KEY. Nenhuma tabela é criada por código.
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
  console.error("Passe o caminho como argumento: npm run migrate:matches -- /caminho/fc-arena.sqlite");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const localMatches = db
  .prepare(
    `SELECT id,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at
     FROM matches ORDER BY id`,
  )
  .all();
db.close();

console.log(`SQLite: ${dbPath}`);
console.log(`Partidas locais encontradas: ${localMatches.length}`);

if (localMatches.length === 0) {
  console.log("Nada a migrar (nenhuma partida no banco local).");
  process.exit(0);
}

const withChampionship = localMatches.filter((row) => row.championship_id != null).length;
if (withChampionship > 0) {
  console.log(
    `Obs.: ${withChampionship} partida(s) têm vínculo de campeonato no SQLite. ` +
      "O vínculo NÃO é enviado (championship_id vira NULL no remoto): public.championships " +
      "está vazia até a Etapa 5. Nada se perde — os ids são preservados e o backfill " +
      "poderá ser feito por SQL quando championships migrar.",
  );
}

// --- Supabase: login da conta de serviço + upsert preservando ids -----------
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: APP_EMAIL,
  password: APP_PASSWORD,
});
if (authError) {
  console.error(`ERRO: login da conta de serviço falhou: ${authError.message}`);
  console.error("Verifique SUPABASE_APP_EMAIL/SUPABASE_APP_PASSWORD e se o usuário tem e-mail confirmado.");
  process.exit(1);
}
const createdBy = authData?.user?.id || authData?.session?.user?.id;
if (!createdBy) {
  console.error("ERRO: login OK, mas o Supabase não retornou o uuid do usuário (created_by).");
  process.exit(1);
}
console.log(`Login OK como ${APP_EMAIL} (created_by=${createdBy}).`);

const payload = localMatches.map((row) => ({
  id: row.id,
  player1_id: row.player1_id,
  player2_id: row.player2_id,
  team1_id: row.team1_id,
  team2_id: row.team2_id,
  score1: row.score1,
  score2: row.score2,
  // Decisão Etapa 4: vínculo de campeonato NUNCA vai ao remoto nesta etapa.
  championship_id: null,
  played_at: row.played_at || new Date().toISOString(),
  created_by: createdBy,
}));

// Tentativa em lote (upsert on id). Se algo falhar (ex.: FK 23503 por
// players/teams não migrados), refaz linha a linha para reportar exatamente
// quais falharam.
const { data: batchData, error: batchError } = await supabase
  .from("matches")
  .upsert(payload, { onConflict: "id" })
  .select("id");

let okCount = 0;
const failures = [];

if (!batchError) {
  okCount = (batchData || []).length;
} else {
  console.warn(`Upsert em lote falhou (${batchError.code || "n/d"}: ${batchError.message}). Tentando linha a linha...`);
  for (const row of payload) {
    const { error } = await supabase.from("matches").upsert(row, { onConflict: "id" }).select("id");
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
  if (fail.code === "23503") {
    console.error(
      "    -> FK violada: rode antes `npm run migrate:players` e `npm run migrate:teams`.",
    );
  }
}

const maxId = localMatches.reduce((max, row) => Math.max(max, Number(row.id)), 0);

console.log(`
────────────────────────────────────────────────────────────────────────────
PRÓXIMO PASSO OBRIGATÓRIO (uma única vez, no SQL Editor do Supabase):
ajuste a sequência de ids para que novas partidas não colidam com as migradas:

  select setval(
    pg_get_serial_sequence('public.matches', 'id'),
    (select coalesce(max(id), 1) from public.matches)
  );

(maior id migrado: ${maxId})

Lembrete: a partir da Etapa 4 o aplicativo ESCREVE partidas no Supabase
automaticamente (id gerado no remoto), mas a LEITURA segue sempre local.
Rode este script novamente se criar partidas em modo legado (sem .env) para
realignear histórico/sequência. A conta de serviço precisa ter profile com
papel 'admin' (veja supabase/SETUP.md). Nada neste script cria tabelas.
────────────────────────────────────────────────────────────────────────────`);

process.exit(failures.length > 0 ? 2 : 0);
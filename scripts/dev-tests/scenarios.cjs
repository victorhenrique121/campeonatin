#!/usr/bin/env node
/**
 * Cenários de teste da Etapa 2 (players -> Supabase com espelho local).
 * Executados pelo run-stage2-tests.cjs contra o mock-supabase.cjs.
 *
 * Uso: node scripts/dev-tests/scenarios.cjs <s1|s2|s3a|s3b|s4|s5|s6|s7|s8|s9>
 *
 * Cada cenário roda em processo próprio (o módulo main/supabase.ts mantém
 * estado singleton por processo). As variáveis de ambiente são definidas pelo
 * orquestrador.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJ = path.join(__dirname, "..", "..");
const MAIN = path.join(PROJ, "dist-electron", "main");
const TMP = path.join(os.tmpdir(), "fc-arena-stage2-tests");
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:54331";

fs.mkdirSync(TMP, { recursive: true });

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ""}`);
  }
}

function newDb(name) {
  const { createDatabase, repository } = require(path.join(MAIN, "repository.js"));
  const file = path.join(TMP, `${name}.sqlite`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { fs.rmSync(f); } catch { /* ignore */ }
  }
  const db = createDatabase(file);
  return { db, repo: repository(db), file };
}

function ctx(name, opts = {}) {
  const { db, repo, file } = newDb(name);
  const sup = require(path.join(MAIN, "supabase.js"));
  const sessionFile = path.join(TMP, `${opts.sessionBase || name}-session.json`);
  if (!opts.keepSession) {
    try { fs.rmSync(sessionFile); } catch { /* ignore */ }
  }
  sup.initSupabase({ sessionStoragePath: sessionFile });
  const { createPlayersService } = require(path.join(MAIN, "players-service.js"));
  const service = createPlayersService(db, repo);
  return { db, repo, sup, service, file, sessionFile };
}

async function mockState() {
  const res = await fetch(`${MOCK}/__state`);
  return res.json();
}

async function setMode(tableMissing) {
  await fetch(`${MOCK}/__mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tableMissing }),
  });
}

async function expectThrows(label, promise, messagePart) {
  try {
    await promise;
    check(label, false, "não lançou erro");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, messagePart ? message.includes(messagePart) : true, message);
  }
}

const SQLITE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// =============================================================================
const scenarios = {
  /** Sem .env/vars: modo legado 100% SQLite — comportamento idêntico ao pré-Etapa 2. */
  async s1() {
    console.log("S1 — Modo legado (Supabase não configurado):");
    const c = ctx("s1");
    check("list() vazio inicial", (await c.service.list()).length === 0);
    const p1 = await c.service.save({ name: "Jogador Um", nickname: "s1-um" });
    const p2 = await c.service.save({ name: "Jogador Dois", nickname: "s1-dois" });
    check("save() cria no SQLite local", Number.isInteger(p1.id) && p1.id > 0, p1);
    check("list() reflete criações", (await c.service.list()).length === 2);
    // saveMatch continua validando players no SQLite (FK/JOIN intactos):
    const teams = c.repo.teams();
    const matchId = c.repo.saveMatch({
      player1Id: p1.id, player2Id: p2.id,
      team1Id: teams[0].id, team2Id: teams[1].id,
      score1: 2, score2: 0,
    });
    check("saveMatch() funciona com jogadores locais", Number.isInteger(matchId));
    check("ranking() inclui jogadores", c.repo.ranking().length === 2);
    await c.service.remove(p1.id);
    check("remove() apaga em cascata (matches junto)", c.repo.players().length === 1 && c.repo.matches().length === 0);
    await expectThrows("save() sem nome/apelido -> mesma mensagem de sempre",
      c.service.save({ name: "", nickname: "" }), "Nome e apelido são obrigatórios.");
    c.db.close();
  },

  /** Fluxo completo: login, CRUD remoto, espelho com mesmos ids, cascata de exclusão. */
  async s2() {
    console.log("S2 — Fluxo completo com Supabase (mock) + espelho local:");
    const c = ctx("s2");
    const auth = await c.sup.ensureAuthenticated();
    check("ensureAuthenticated -> signed-in", auth.ok && auth.reason === "signed-in", auth);
    check("arquivo de sessão criado", fs.existsSync(c.sessionFile));

    const p1 = await c.service.save({ name: "Victor", nickname: "s2-victor" });
    check("save() cria no Supabase e devolve Player", Number.isInteger(p1.id) && p1.name === "Victor", p1);
    check("createdAt normalizado p/ formato SQLite", SQLITE_TS.test(p1.createdAt), p1.createdAt);

    const mirror = c.db.prepare("SELECT id,name,nickname,avatar,created_at FROM players WHERE id=?").get(p1.id);
    check("espelho local tem o MESMO id", mirror && Number(mirror.id) === p1.id, mirror);
    check("espelho created_at normalizado", mirror && SQLITE_TS.test(mirror.created_at), mirror);

    const p2 = await c.service.save({ name: "Ana", nickname: "s2-ana" });
    const p1u = await c.service.save({ id: p1.id, name: "Victor H", nickname: "s2-victor" });
    check("save() com id atualiza remotamente", p1u.name === "Victor H", p1u);
    check("espelho acompanha update", c.db.prepare("SELECT name FROM players WHERE id=?").get(p1.id).name === "Victor H");

    await expectThrows("nickname duplicado -> erro amigável",
      c.service.save({ name: "Outro", nickname: "s2-victor" }), "Já existe um jogador com esse apelido.");

    const listed = await c.service.list();
    check("list() vem do Supabase ordenado por nome", listed.length === 2 && listed[0].name === "Ana", listed);

    // FK/JOIN locais continuam funcionando com os ids espelhados:
    const teams = c.repo.teams();
    const matchId = c.repo.saveMatch({
      player1Id: p1.id, player2Id: p2.id,
      team1Id: teams[0].id, team2Id: teams[1].id,
      score1: 3, score2: 1,
    });
    check("saveMatch() (SQLite) aceita ids do espelho", Number.isInteger(matchId));
    check("matches:list JOIN mostra nomes", c.repo.matches().some((m) => m.player1 === "Victor H"));
    check("dashboard() segue funcionando", typeof c.repo.dashboard() === "object");
    check("ranking() segue funcionando", c.repo.ranking().length === 2);

    // Exclusão com cascata remota + local:
    await c.service.remove(p1.id);
    const state = await mockState();
    check("remoto: player excluído", !state.players.some((p) => Number(p.id) === p1.id), state.players);
    check("local: cascata removeu player e match", c.repo.players().length === 1 && c.repo.matches().length === 0);
    c.db.close();
  },

  /** Sessão persiste entre reinicializações (sem novo login). */
  async s3a() {
    console.log("S3a — Primeiro boot: login da conta de serviço:");
    const c = ctx("s3", { sessionBase: "s3" });
    const before = (await mockState()).authCalls;
    const auth = await c.sup.ensureAuthenticated();
    const after = (await mockState()).authCalls;
    check("login realizado (authCalls +1)", auth.ok && after === before + 1, { before, after });
    c.db.close();
  },
  async s3b() {
    console.log("S3b — Segundo boot: sessão restaurada do arquivo (sem novo login):");
    const c = ctx("s3", { sessionBase: "s3", keepSession: true });
    const before = (await mockState()).authCalls;
    const auth = await c.sup.ensureAuthenticated();
    const after = (await mockState()).authCalls;
    check("sessão reaproveitada (authCalls igual)", auth.ok && after === before, { before, after });
    c.db.close();
  },

  /** Supabase configurado, porém fora do ar: leitura cai no espelho; escrita bloqueia. */
  async s4() {
    console.log("S4 — Offline (URL morta): leitura via espelho, escrita bloqueada:");
    const c = ctx("s4");
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (77,'Off Player','s4-off',NULL,'2026-01-01 00:00:00')").run();
    const listed = await c.service.list();
    check("list() cai para o espelho local", listed.length === 1 && listed[0].id === 77, listed);
    await expectThrows("save() bloqueado com erro amigável",
      c.service.save({ name: "Novo", nickname: "s4-novo" }), "Não foi possível alcançar o Supabase");
    await expectThrows("remove() bloqueado com erro amigável", c.service.remove(77), "Não foi possível alcançar o Supabase");
    check("dados locais intactos após falhas", c.repo.players().length === 1);
    c.db.close();
  },

  /** Credenciais da conta de serviço erradas: leitura via espelho, escrita bloqueada, teste reporta. */
  async s5() {
    console.log("S5 — Credenciais de serviço inválidas:");
    const c = ctx("s5");
    const test = await c.sup.testSupabaseConnection();
    check("testSupabaseConnection -> invalid-credentials", !test.ok && test.reason === "invalid-credentials", test);
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (5,'Local Only','s5-local',NULL,'2026-01-01 00:00:00')").run();
    const listed = await c.service.list();
    check("list() cai para o espelho local", listed.length === 1, listed);
    await expectThrows("save() bloqueado citando a conta de serviço",
      c.service.save({ name: "X", nickname: "s5-x" }), "conta de serviço");
    c.db.close();
  },

  /** Migration não aplicada (PGRST205): nada é criado automaticamente; mensagens orientam. */
  async s6() {
    console.log("S6 — Tabela public.players ausente no Supabase (PGRST205):");
    await setMode(true);
    try {
      const c = ctx("s6");
      const test = await c.sup.testSupabaseConnection();
      check("testSupabaseConnection -> table-missing", !test.ok && test.reason === "table-missing", test);
      await expectThrows("save() orienta aplicar a migration",
        c.service.save({ name: "Y", nickname: "s6-y" }), "supabase/migrations/20260827160000_initial_schema.sql");
      c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (3,'Mirror','s6-mirror',NULL,'2026-01-01 00:00:00')").run();
      const listed = await c.service.list();
      check("list() cai para o espelho local", listed.length === 1, listed);
      c.db.close();
    } finally {
      await setMode(false);
    }
  },

  /** syncMirror() reconstrói o espelho local a partir do Supabase no boot. */
  async s7() {
    console.log("S7 — Sincronização do espelho no boot (syncMirror):");
    const c = ctx("s7");
    const p1 = await c.service.save({ name: "Bia", nickname: "s7-bia" });
    const p2 = await c.service.save({ name: "Cauã", nickname: "s7-caua" });
    c.db.prepare("DELETE FROM players").run(); // simula espelho desatualizado
    check("espelho apagado localmente", c.repo.players().length === 0);
    const synced = await c.service.syncMirror();
    check("syncMirror() restaurou 2 linhas", synced === 2, synced);
    const local = c.repo.players();
    check("ids preservados no espelho", local.some((p) => p.id === p1.id) && local.some((p) => p.id === p2.id), local);
    c.db.close();
  },

  /** Script único de migração de dados preservando ids. */
  async s8() {
    console.log("S8 — Script migrate:players (preserva ids):");
    const { db, file } = newDb("s8");
    db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (5,'Mia','s8-mia',NULL,'2026-02-01 10:00:00')").run();
    db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (9,'Leo','s8-leo',NULL,'2026-02-02 11:00:00')").run();
    db.close();
    const script = path.join(PROJ, "scripts", "migrate-players-to-supabase.mjs");
    const out = execFileSync("node", [script, file], { encoding: "utf8", env: process.env });
    console.log(out.split("\n").filter(Boolean).map((l) => `    | ${l}`).join("\n"));
    check("script imprimiu comando setval obrigatório", out.includes("setval"));
    check("script reportou 2 migrados", out.includes("2 migrado(s)/atualizado(s), 0 falha(s)"));
    const state = await mockState();
    check("Supabase recebeu ids 5 e 9", state.players.some((p) => p.id === 5) && state.players.some((p) => p.id === 9), state.players);
    check("created_at preservado", state.players.find((p) => p.id === 5)?.created_at === "2026-02-01 10:00:00");
    // Reexecutar (idempotência via upsert):
    const out2 = execFileSync("node", [script, file], { encoding: "utf8", env: process.env });
    check("reexecução é idempotente", out2.includes("2 migrado(s)/atualizado(s), 0 falha(s)"));
  },

  /** Compatibilidade Etapa 1: sem conta de serviço, probe anon + espelho/bloqueio. */
  async s9() {
    console.log("S9 — Compatibilidade Etapa 1 (URL+anon, sem conta de serviço):");
    const c = ctx("s9");
    const test = await c.sup.testSupabaseConnection();
    check("testSupabaseConnection -> connected (anon, 0 linhas)", test.ok && test.reason === "connected" && test.authenticated === false, test);
    const auth = await c.sup.ensureAuthenticated();
    check("ensureAuthenticated -> no-service-account", !auth.ok && auth.reason === "no-service-account", auth);
    const listed = await c.service.list();
    check("list() usa espelho local (vazio)", Array.isArray(listed) && listed.length === 0, listed);
    await expectThrows("save() bloqueado até configurar conta de serviço",
      c.service.save({ name: "Z", nickname: "s9-z" }), "SUPABASE_APP_EMAIL");
    c.db.close();
  },
};

// =============================================================================
const name = process.argv[2];
const scenario = scenarios[name];
if (!scenario) {
  console.error(`Cenário desconhecido: ${name}`);
  process.exit(1);
}

scenario()
  .then(() => {
    if (failures > 0) {
      console.error(`Cenário ${name}: ${failures} falha(s).`);
      process.exit(1);
    }
    console.log(`Cenário ${name}: OK`);
  })
  .catch((err) => {
    console.error(`Cenário ${name}: erro inesperado ->`, err);
    process.exit(1);
  });

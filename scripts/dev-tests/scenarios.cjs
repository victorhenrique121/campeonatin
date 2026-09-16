#!/usr/bin/env node
/**
 * Cenários de teste das Etapas 2-4 (players/teams/matches -> Supabase).
 * Executados pelo run-stage2-tests.cjs contra o mock-supabase.cjs.
 *
 * Uso: node scripts/dev-tests/scenarios.cjs <s1|s2|s3a|s3b|s4|s5|s6|s7|s8|s9|s10|s11|s12|s13|s14|s15|s16|s17|s18|s19|s20>
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
  const { createTeamsService } = require(path.join(MAIN, "teams-service.js"));
  const teams = createTeamsService(repo);
  const { createMatchesService } = require(path.join(MAIN, "matches-service.js"));
  const matches = createMatchesService(db, repo);
  return { db, repo, sup, service, teams, matches, file, sessionFile };
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
// Uuid fixo do usuário mockado (mock-supabase.cjs) — criado pela conta de serviço.
const MOCK_USER_ID = "11111111-1111-1111-1111-111111111111";

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

  // ===========================================================================
  // ETAPA 3 — teams (catálogo: leitura remota + fallback local; escrita manual)
  // ===========================================================================

  /** Sem configuração: catálogo 100% local, como antes da Etapa 3. */
  async s10() {
    console.log("S10 — teams no modo legado (Supabase não configurado):");
    const c = ctx("s10");
    const all = await c.teams.list();
    check("list() devolve o catálogo local completo", all.length === c.repo.teams().length && all.length > 600, all.length);
    const search = await c.teams.list("real");
    check("busca local (LIKE) preservada", search.length === c.repo.teams("real").length && search.length > 0, search.length);
    c.db.close();
  },

  /** Fluxo remoto: script de migração, leitura autenticada, busca ilike, prova de origem remota. */
  async s11() {
    console.log("S11 — teams: migrate:teams + leitura remota + busca:");
    const c = ctx("s11");
    const localCount = c.repo.teams().length;

    const script = path.join(PROJ, "scripts", "migrate-teams-to-supabase.mjs");
    const out = execFileSync("node", [script, c.file], { encoding: "utf8", env: process.env });
    check("script migrou o catálogo inteiro preservando ids", out.includes(`${localCount} migrado(s)/atualizado(s), 0 falha(s)`), out.split("\n").find((l) => l.includes("Resultado")));
    check("script imprimiu setval de public.teams", out.includes("pg_get_serial_sequence('public.teams'"));

    const state = await mockState();
    check("Supabase recebeu as equipes", state.teams.length === localCount && state.teams.some((t) => t.id === 1), state.teams.length);

    const remote = await c.teams.list();
    check("list() devolve o catálogo remoto", remote.length === localCount);
    check("conteúdo remoto == local (ordem por nome)",
      JSON.stringify(remote.map((t) => t.id)) === JSON.stringify(c.repo.teams().map((t) => t.id)));

    const search = await c.teams.list("real");
    check("busca remota (ilike) equivalente ao LIKE local",
      search.length === c.repo.teams("real").length && search.length > 0, search.length);
    const none = await c.teams.list("zzz-inexistente-xyz");
    check("busca remota sem resultados -> lista vazia", none.length === 0);

    // Prova de que a leitura vem do REMOTO: apaga um time do catálogo local.
    const victim = remote[0];
    c.db.prepare("DELETE FROM teams WHERE id=?").run(victim.id);
    const still = await c.teams.list();
    check("list() não depende do espelho local quando online", still.some((t) => t.id === victim.id));

    const out2 = execFileSync("node", [script, c.file], { encoding: "utf8", env: process.env });
    check("reexecução do script é idempotente", out2.includes("0 falha(s)"));
    c.db.close();
  },

  /** Offline (URL morta): leitura cai para o catálogo local, sem travar. */
  async s12() {
    console.log("S12 — teams offline: fallback para o catálogo local:");
    const c = ctx("s12");
    const listed = await c.teams.list();
    check("list() cai para o catálogo local", listed.length === c.repo.teams().length && listed.length > 600, listed.length);
    check("busca também cai para o local", (await c.teams.list("real")).length === c.repo.teams("real").length);
    c.db.close();
  },

  /** Configurado, mas sem conta de serviço: leitura via catálogo local (RLS bloqueia anon). */
  async s13() {
    console.log("S13 — teams sem conta de serviço: fallback local:");
    const c = ctx("s13");
    const listed = await c.teams.list();
    check("list() usa catálogo local (anon não lê teams por RLS)", listed.length === c.repo.teams().length && listed.length > 600, listed.length);
    c.db.close();
  },

  // ===========================================================================
  // ETAPA 4 — matches (híbrido: escrita remota estrita-online + leitura local)
  // ===========================================================================

  /** Sem configuração: CRUD 100% SQLite, comportamento idêntico ao pré-Etapa 4. */
  async s14() {
    console.log("S14 — matches no modo legado (Supabase não configurado):");
    const c = ctx("s14");
    const teams = c.repo.teams();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (1,'Um','s14-um',NULL,'2026-01-01 00:00:00')").run();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (2,'Dois','s14-dois',NULL,'2026-01-01 00:00:00')").run();
    const input = { player1Id: 1, player2Id: 2, team1Id: teams[0].id, team2Id: teams[1].id, score1: 2, score2: 0 };

    const id = await c.matches.save(input);
    check("save() legado cria no SQLite (id local)", Number.isInteger(id) && c.repo.matches().some((m) => m.id === id), id);

    const edited = await c.matches.update({ ...input, id, score1: 3 });
    check("update() legado altera placar", edited === id && c.repo.matches().find((m) => m.id === id).score1 === 3);

    await expectThrows("update() legado inexistente -> mensagem de sempre",
      c.matches.update({ ...input, id: 999 }), "Partida não encontrada.");
    await expectThrows("save() legado com jogadores iguais -> mensagem de sempre",
      c.matches.save({ ...input, player2Id: 1 }), "Escolha jogadores e times diferentes.");

    await c.matches.remove(id);
    check("remove() legado apaga", c.repo.matches().length === 0);
    await expectThrows("remove() inexistente -> mensagem de sempre", c.matches.remove(999), "Partida não encontrada.");

    await c.matches.save(input);
    await c.matches.save({ ...input, score1: 1, score2: 1 });
    c.matches.clear();
    check("clear() legado apaga tudo", c.repo.matches().length === 0);
    check("syncMirror() legado -> 0", (await c.matches.syncMirror()) === 0);
    c.db.close();
  },

  /** Fluxo remoto completo: id gerado no Supabase, created_by, espelho, update e delete. */
  async s15() {
    console.log("S15 — matches: escrita remota + espelho local com o MESMO id:");
    const c = ctx("s15");
    const p1 = await c.service.save({ name: "Rafa", nickname: "s15-rafa" });
    const p2 = await c.service.save({ name: "Téo", nickname: "s15-teo" });
    const teams = c.repo.teams();
    const input = { player1Id: p1.id, player2Id: p2.id, team1Id: teams[0].id, team2Id: teams[1].id, score1: 4, score2: 2 };

    const id = await c.matches.save(input);
    const remote = (await mockState()).matches.find((m) => Number(m.id) === Number(id));
    check("save() cria no Supabase (id gerado no remoto)", Boolean(remote), id);
    check("remoto: championship_id NULL (decisão Etapa 4)", remote && remote.championship_id === null);
    check("remoto: created_by = uuid da conta de serviço", remote && remote.created_by === MOCK_USER_ID, remote && remote.created_by);

    const local = c.db.prepare("SELECT id,score1,championship_id,played_at FROM matches WHERE id=?").get(id);
    check("local: partida gravada com o id do Supabase", local && Number(local.id) === Number(id), local);
    check("local: played_at idêntico ao remoto", local && remote && local.played_at === remote.played_at,
      { local: local && local.played_at, remote: remote && remote.played_at });
    check("matches:list (SEMPRE local) mostra a partida com nomes do JOIN",
      c.repo.matches().some((m) => m.id === Number(id) && m.player1 === "Rafa"));

    await c.matches.update({ ...input, id, score1: 5, playedAt: local.played_at });
    check("update() reflete no remoto", (await mockState()).matches.find((m) => Number(m.id) === Number(id)).score1 === 5);
    check("update() reflete no local", c.db.prepare("SELECT score1 FROM matches WHERE id=?").get(id).score1 === 5);

    await c.matches.remove(id);
    check("remove() apaga no remoto", !(await mockState()).matches.some((m) => Number(m.id) === Number(id)));
    check("remove() apaga no local", c.repo.matches().length === 0);
    c.db.close();
  },

  /** Partida de campeonato: vínculo/fixture locais intactos, remoto sem championship_id. */
  async s16() {
    console.log("S16 — matches de campeonato: vínculo local intacto, remoto NULL:");
    const c = ctx("s16");
    const p1 = await c.service.save({ name: "Ivo", nickname: "s16-ivo" });
    const p2 = await c.service.save({ name: "Uli", nickname: "s16-uli" });
    const teams = c.repo.teams();
    const champ = c.repo.saveChampionship({
      name: "Copa S16", format: "league", startsAt: "2026-09-01T00:00:00.000Z",
      status: "active", participantIds: [p1.id, p2.id],
    });

    const id = await c.matches.save({
      player1Id: p1.id, player2Id: p2.id, team1Id: teams[0].id, team2Id: teams[1].id,
      score1: 2, score2: 0, championshipId: champ.id,
    });
    const local = c.db.prepare("SELECT championship_id FROM matches WHERE id=?").get(id);
    check("local: championship_id preservado no SQLite", local && Number(local.championship_id) === Number(champ.id), local);
    const fixture = c.db.prepare("SELECT match_id FROM fixtures WHERE championship_id=?").get(champ.id);
    check("local: fixture vinculada (match_id = id do Supabase)", fixture && Number(fixture.match_id) === Number(id), fixture);
    const remote = (await mockState()).matches.find((m) => Number(m.id) === Number(id));
    check("remoto: championship_id NULL (championships só migra na Etapa 5)", remote && remote.championship_id === null);
    check("UI: matches:list mantém o rótulo do campeonato", c.repo.matches().some((m) => m.id === Number(id) && m.championship === "Copa S16"));
    const detail = c.repo.championshipDetail(champ.id);
    check("calendário vê o placar via fixtures LEFT JOIN matches",
      detail.fixtures.some((f) => Number(f.matchId) === Number(id) && f.score1 === 2), detail.fixtures);

    await expectThrows("save() sem confronto pendente -> mensagem de sempre",
      c.matches.save({
        player1Id: p1.id, player2Id: p2.id, team1Id: teams[0].id, team2Id: teams[1].id,
        score1: 1, score2: 0, championshipId: champ.id,
      }),
      "Este confronto não está pendente neste campeonato.");
    check("validação local ANTES do remoto: nenhuma linha remota órfã",
      (await mockState()).matches.length === 1);
    c.db.close();
  },

  /** Offline (URL morta): escrita bloqueada sem divergência; leitura/clear seguem locais. */
  async s17() {
    console.log("S17 — matches offline: escrita bloqueada, leitura local intacta:");
    const c = ctx("s17");
    const teams = c.repo.teams();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (1,'Um','s17-um',NULL,'2026-01-01 00:00:00')").run();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (2,'Dois','s17-dois',NULL,'2026-01-01 00:00:00')").run();
    const input = { player1Id: 1, player2Id: 2, team1Id: teams[0].id, team2Id: teams[1].id, score1: 2, score2: 0 };

    await expectThrows("save() bloqueado com erro amigável", c.matches.save(input), "Não foi possível alcançar o Supabase");
    check("nenhuma partida criada localmente (sem divergência)", c.repo.matches().length === 0);

    const lid = c.repo.saveMatch(input); // partida pré-Etapa 4 (só local)
    await expectThrows("update() bloqueado com erro amigável",
      c.matches.update({ ...input, id: lid, score1: 7 }), "Não foi possível alcançar o Supabase");
    check("placar local inalterado após update bloqueado", c.repo.matches().find((m) => m.id === lid).score1 === 2);
    await expectThrows("remove() bloqueado com erro amigável", c.matches.remove(lid), "Não foi possível alcançar o Supabase");
    check("partida local intacta após remove bloqueado", c.repo.matches().length === 1);
    check("matches:list (leitura local) segue funcional offline", c.repo.matches().some((m) => m.player1 === "Um"));

    c.matches.clear();
    check("clear() local-only funciona até offline", c.repo.matches().length === 0);
    check("syncMirror() offline -> 0", (await c.matches.syncMirror()) === 0);
    c.db.close();
  },

  /** Configurado, mas sem conta de serviço: escrita bloqueada; leitura local funciona. */
  async s18() {
    console.log("S18 — matches sem conta de serviço: escrita bloqueada, leitura local:");
    const c = ctx("s18");
    const teams = c.repo.teams();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (1,'Um','s18-um',NULL,'2026-01-01 00:00:00')").run();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (2,'Dois','s18-dois',NULL,'2026-01-01 00:00:00')").run();
    const input = { player1Id: 1, player2Id: 2, team1Id: teams[0].id, team2Id: teams[1].id, score1: 1, score2: 0 };

    await expectThrows("save() bloqueado citando a conta de serviço", c.matches.save(input), "SUPABASE_APP_EMAIL");
    check("nada criado localmente (sem divergência)", c.repo.matches().length === 0);
    check("syncMirror() sem conta de serviço -> 0", (await c.matches.syncMirror()) === 0);
    check("matches:list (local) segue funcionando", Array.isArray(c.repo.matches()) && c.repo.matches().length === 0);
    c.db.close();
  },

  /** Regra de ouro do syncMirror: importa o remoto SEM sobrescrever championship_id local. */
  async s19() {
    console.log("S19 — syncMirror: importa remoto preservando championship_id local:");
    const c = ctx("s19");
    const teams = c.repo.teams();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (1,'Um','s19-um',NULL,'2026-01-01 00:00:00')").run();
    c.db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (2,'Dois','s19-dois',NULL,'2026-01-01 00:00:00')").run();
    const champ = c.repo.saveChampionship({
      name: "Copa S19", format: "league", startsAt: "2026-09-01T00:00:00.000Z",
      status: "active", participantIds: [1, 2],
    });
    const lid = c.repo.saveMatch({
      player1Id: 1, player2Id: 2, team1Id: teams[0].id, team2Id: teams[1].id,
      score1: 2, score2: 0, championshipId: champ.id,
    });

    // Popula o remoto diretamente (simula outra máquina / migração):
    const supabase = c.sup.getSupabase();
    const { error: loginErr } = await supabase.auth.signInWithPassword({
      email: process.env.SUPABASE_APP_EMAIL,
      password: process.env.SUPABASE_APP_PASSWORD,
    });
    check("login mock para popular o remoto", !loginErr, loginErr && loginErr.message);
    const { error: e1 } = await supabase.from("matches").insert({
      id: lid, player1_id: 1, player2_id: 2, team1_id: teams[0].id, team2_id: teams[1].id,
      score1: 9, score2: 0, played_at: "2026-09-10T12:00:00.000Z", created_by: MOCK_USER_ID,
    });
    const { error: e2 } = await supabase.from("matches").insert({
      player1_id: 1, player2_id: 2, team1_id: teams[2].id, team2_id: teams[3].id,
      score1: 1, score2: 1, played_at: "2026-09-11T12:00:00.000Z", created_by: MOCK_USER_ID,
    });
    check("remoto populado (mesma partida + partida nova)", !e1 && !e2, { e1: e1 && e1.message, e2: e2 && e2.message });

    const synced = await c.matches.syncMirror();
    check("syncMirror() importou 2 partidas", synced === 2, synced);
    const local = c.db.prepare("SELECT score1,championship_id FROM matches WHERE id=?").get(lid);
    check("dados remotos aplicados no espelho (placar 9)", local && local.score1 === 9, local);
    check("REGRA DE OURO: championship_id local preservado (não sobrescrito pelo NULL remoto)",
      local && Number(local.championship_id) === Number(champ.id), local);
    const fixture = c.db.prepare("SELECT match_id FROM fixtures WHERE championship_id=?").get(champ.id);
    check("fixture segue vinculada após o sync", fixture && Number(fixture.match_id) === Number(lid), fixture);
    const others = c.db.prepare("SELECT id,championship_id FROM matches WHERE id<>? ORDER BY id").all(lid);
    check("partida nova do remoto importada (championship_id NULL)",
      others.length === 1 && others[0].championship_id === null, others);
    check("UI: rótulo do campeonato preservado após o sync",
      c.repo.matches().some((m) => m.id === Number(lid) && m.championship === "Copa S19"));
    c.db.close();
  },

  /** Script único de migração do histórico preservando ids (championship_id -> NULL). */
  async s20() {
    console.log("S20 — Script migrate:matches (preserva ids, championship_id NULL):");
    const { db, repo, file } = newDb("s20");
    db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (5,'Mia','s20-mia',NULL,'2026-02-01 10:00:00')").run();
    db.prepare("INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (9,'Leo','s20-leo',NULL,'2026-02-02 11:00:00')").run();
    const teams = repo.teams();
    const free = repo.saveMatch({
      player1Id: 5, player2Id: 9, team1Id: teams[0].id, team2Id: teams[1].id,
      score1: 3, score2: 3, playedAt: "2026-03-01T10:00:00.000Z",
    });
    const champ = repo.saveChampionship({
      name: "Copa S20", format: "league", startsAt: "2026-09-01T00:00:00.000Z",
      status: "active", participantIds: [5, 9],
    });
    const cup = repo.saveMatch({
      player1Id: 5, player2Id: 9, team1Id: teams[0].id, team2Id: teams[1].id,
      score1: 1, score2: 0, championshipId: champ.id, playedAt: "2026-03-02T10:00:00.000Z",
    });
    db.close();

    const script = path.join(PROJ, "scripts", "migrate-matches-to-supabase.mjs");
    const out = execFileSync("node", [script, file], { encoding: "utf8", env: process.env });
    console.log(out.split("\n").filter(Boolean).map((l) => `    | ${l}`).join("\n"));
    check("script imprimiu comando setval obrigatório", out.includes("pg_get_serial_sequence('public.matches'"));
    check("script reportou 2 migrados", out.includes("2 migrado(s)/atualizado(s), 0 falha(s)"));
    check("script avisou do vínculo de campeonato omitido", out.includes("1 partida(s) têm vínculo de campeonato"));

    const state = await mockState();
    const rFree = state.matches.find((m) => Number(m.id) === Number(free));
    const rCup = state.matches.find((m) => Number(m.id) === Number(cup));
    check("Supabase recebeu as partidas com ids preservados", Boolean(rFree) && Boolean(rCup), state.matches);
    check("championship_id -> NULL no remoto (mesmo na partida de campeonato)", rCup && rCup.championship_id === null);
    check("created_by preenchido com a conta de serviço", rFree && rFree.created_by === MOCK_USER_ID);
    check("played_at preservado", rFree && rFree.played_at === "2026-03-01T10:00:00.000Z", rFree && rFree.played_at);

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
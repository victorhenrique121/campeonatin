#!/usr/bin/env node
/**
 * Mock local de Supabase (GoTrue/Auth + PostgREST/REST) para os testes da
 * Etapa 2 — permite validar o fluxo completo (login, CRUD de players, RLS,
 * erros PGRST) sem acessar supabase.co (útil em redes/sandboxes bloqueadas).
 *
 * NÃO faz parte do aplicativo: é apenas infraestrutura de teste.
 *
 * Endpoints de controle (só para o harness):
 *   POST /__reset            -> zera estado (players/matches/fixtures/authCalls)
 *   POST /__mode {tableMissing} -> simula migration não aplicada (PGRST205)
 *   GET  /__state            -> estado atual (para asserções)
 */
const http = require("http");

const PORT = Number(process.env.MOCK_PORT || 54331);
const USER_EMAIL = process.env.MOCK_USER_EMAIL || "app@fcarena.local";
const USER_PASSWORD = process.env.MOCK_USER_PASSWORD || "senha-mock-123";
const ACCESS_TOKEN = "mock-access-token";

let players = [];
let matches = [];
let fixtures = [];
let nextIds = { players: 1, matches: 1, fixtures: 1 };
let authCalls = 0;
let tableMissing = false;

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  aud: "authenticated",
  role: "admin",
  email: USER_EMAIL,
  email_confirmed_at: "2026-01-01T00:00:00Z",
  confirmed_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { display_name: "Conta de Serviço" },
  identities: [],
  is_anonymous: false,
};

function sessionJson(refreshToken) {
  return {
    access_token: ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refreshToken,
    user: USER,
  };
}

function send(res, code, body, headers = {}) {
  const isJson = body !== undefined && body !== null && body !== "";
  res.writeHead(code, {
    "content-type": "application/json",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body || "");
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function nicknameConflict(nickname, ignoreId) {
  return players.some(
    (p) => p.nickname === nickname && Number(p.id) !== Number(ignoreId),
  );
}

function bumpId(table, id) {
  nextIds[table] = Math.max(nextIds[table], Number(id) + 1);
}

function parseEq(searchParams, column) {
  const value = searchParams.get(column); // ex.: "eq.5"
  if (!value) return null;
  const match = /^eq\.(\d+)$/.exec(value);
  return match ? Number(match[1]) : null;
}

function parseOrPairs(searchParams) {
  // ex.: or=(player1_id.eq.3,player2_id.eq.3)
  const value = searchParams.get("or");
  if (!value) return null;
  const ids = [...value.matchAll(/(\w+)\.eq\.(\d+)/g)].map((m) => Number(m[2]));
  return ids.length ? ids : null;
}

function matchesOrFilters(row, orIds) {
  if (!orIds) return true;
  return orIds.some(
    (id) => Number(row.player1_id) === id || Number(row.player2_id) === id,
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const authed = req.headers.authorization === `Bearer ${ACCESS_TOKEN}`;

  console.log(
    `REQ ${req.method} ${req.url} | authed=${authed} | prefer=${req.headers.prefer || "-"} | apikey=${req.headers.apikey || "-"}`,
  );

  // ---- controle do harness -------------------------------------------------
  if (url.pathname === "/__reset" && req.method === "POST") {
    players = [];
    matches = [];
    fixtures = [];
    nextIds = { players: 1, matches: 1, fixtures: 1 };
    authCalls = 0;
    tableMissing = false;
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__mode" && req.method === "POST") {
    const body = await readBody(req);
    tableMissing = Boolean(body && body.tableMissing);
    return send(res, 200, { ok: true, tableMissing });
  }
  if (url.pathname === "/__state" && req.method === "GET") {
    return send(res, 200, { players, matches, fixtures, authCalls, tableMissing });
  }

  // ---- GoTrue (Auth) --------------------------------------------------------
  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    authCalls += 1;
    const grant = url.searchParams.get("grant_type");
    if (grant === "refresh_token") {
      return send(res, 200, sessionJson(`mock-refresh-${authCalls}`));
    }
    const body = (await readBody(req)) || {};
    if (body.email === USER_EMAIL && body.password === USER_PASSWORD) {
      return send(res, 200, sessionJson(`mock-refresh-${authCalls}`));
    }
    return send(res, 400, {
      error: "invalid_grant",
      error_description: "Invalid login credentials",
      message: "Invalid login credentials",
      code: "invalid_credentials",
    });
  }
  if (url.pathname === "/auth/v1/user" && req.method === "GET") {
    if (!authed) return send(res, 401, { error: "unauthorized", message: "unauthorized" });
    return send(res, 200, USER);
  }
  if (url.pathname === "/auth/v1/logout" && req.method === "POST") {
    return send(res, 204, null);
  }

  // ---- PostgREST (REST) -----------------------------------------------------
  const restMatch = /^\/rest\/v1\/(\w+)$/.exec(url.pathname);
  if (!restMatch) return send(res, 404, { message: "rota não encontrada no mock" });
  const table = restMatch[1];

  if (tableMissing && table === "players") {
    return send(res, 404, {
      code: "PGRST205",
      message: "Could not find the table 'public.players' in the schema cache",
      details: null,
      hint: null,
    });
  }

  const rowsOf = { players: () => players, matches: () => matches, fixtures: () => fixtures }[table];
  if (!rowsOf) return send(res, 404, { code: "PGRST205", message: `mock: tabela ${table} não modelada` });

  const wantsRepresentation = String(req.headers.prefer || "").includes("return=representation");
  const isUpsert = String(req.headers.prefer || "").includes("resolution=merge-duplicates");
  const idFilter = parseEq(url.searchParams, "id");
  const orIds = parseOrPairs(url.searchParams);

  // RLS simulado: sem sessão 'authenticated' -> SELECT vazio / escrita negada.
  if (req.method === "GET") {
    if (!authed) return send(res, 200, [], { "content-range": "*/0" });
    let rows = rowsOf();
    if (idFilter !== null) rows = rows.filter((r) => Number(r.id) === idFilter);
    if (orIds) rows = rows.filter((r) => matchesOrFilters(r, orIds));
    const order = url.searchParams.get("order"); // ex.: "name.asc" / "id.asc"
    if (order) {
      const [column, direction] = order.split(".");
      rows = [...rows].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0));
      if (direction === "desc") rows.reverse();
    }
    const limit = url.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    return send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
  }

  if (!authed) {
    return send(res, 403, {
      code: "42501",
      message: `new row violates row-level security policy for table ${table}`,
      details: null,
      hint: null,
    });
  }

  if (req.method === "POST" && (table === "players")) {
    const body = await readBody(req);
    const incoming = Array.isArray(body) ? body : [body];
    const out = [];
    for (const row of incoming) {
      const id = row.id != null ? Number(row.id) : nextIds.players;
      if (nicknameConflict(row.nickname, id)) {
        return send(res, 409, {
          code: "23505",
          message: 'duplicate key value violates unique constraint "players_nickname_key"',
          details: `Key (nickname)=(${row.nickname}) already exists.`,
          hint: null,
        });
      }
      const existingIndex = players.findIndex((p) => Number(p.id) === id);
      const merged = {
        id,
        name: row.name,
        nickname: row.nickname,
        avatar: row.avatar ?? null,
        created_at: row.created_at || (existingIndex >= 0 ? players[existingIndex].created_at : new Date().toISOString()),
        updated_at: new Date().toISOString(),
        user_id: null,
      };
      if (existingIndex >= 0 && isUpsert) players[existingIndex] = merged;
      else if (existingIndex >= 0) {
        return send(res, 409, {
          code: "23505",
          message: 'duplicate key value violates unique constraint "players_pkey"',
          details: `Key (id)=(${id}) already exists.`,
          hint: null,
        });
      } else players.push(merged);
      bumpId("players", id);
      out.push(merged);
    }
    // PostgREST real SEMPRE responde array com return=representation.
    return send(res, isUpsert ? 200 : 201, wantsRepresentation ? out : null);
  }

  if (req.method === "PATCH" && table === "players") {
    const body = (await readBody(req)) || {};
    if (idFilter === null) return send(res, 400, { code: "PGRST100", message: "mock: PATCH sem filtro id" });
    const row = players.find((p) => Number(p.id) === idFilter);
    if (!row) return send(res, 200, wantsRepresentation ? [] : null);
    if (body.nickname && nicknameConflict(body.nickname, row.id)) {
      return send(res, 409, {
        code: "23505",
        message: 'duplicate key value violates unique constraint "players_nickname_key"',
        details: `Key (nickname)=(${body.nickname}) already exists.`,
        hint: null,
      });
    }
    Object.assign(row, body, { updated_at: new Date().toISOString() });
    return send(res, 200, wantsRepresentation ? [row] : null);
  }

  if (req.method === "DELETE") {
    const store = rowsOf();
    let removed = [];
    const keep = store.filter((row) => {
      const hit =
        (idFilter !== null && Number(row.id) === idFilter) ||
        (orIds && matchesOrFilters(row, orIds));
      if (hit) removed.push(row);
      return !hit;
    });
    if (table === "players") players = keep;
    else if (table === "matches") matches = keep;
    else fixtures = keep;
    return send(res, 200, wantsRepresentation ? removed : null);
  }

  return send(res, 405, { message: `mock: método não suportado ${req.method} ${table}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock supabase (auth+rest) listening on ${PORT}`);
});

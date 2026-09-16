#!/usr/bin/env node
/**
 * Orquestrador dos testes da Etapa 2 (players -> Supabase).
 *
 *   npm run test:stage2
 *
 * Sobe o mock local de Supabase (Auth + PostgREST), executa cada cenário em um
 * processo separado (com as variáveis de ambiente adequadas) e imprime o
 * resultado consolidado. Não toca em supabase.co — roda 100% offline.
 */
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const PROJ = path.join(__dirname, "..", "..");
const PORT = Number(process.env.MOCK_PORT || 54331);
const MOCK_URL = `http://127.0.0.1:${PORT}`;
const USER_EMAIL = "app@fcarena.local";
const USER_PASSWORD = "senha-mock-123";

const baseEnv = { ...process.env, MOCK_URL };
const configuredEnv = {
  ...baseEnv,
  SUPABASE_URL: MOCK_URL,
  SUPABASE_ANON_KEY: "mock-anon-key",
  SUPABASE_APP_EMAIL: USER_EMAIL,
  SUPABASE_APP_PASSWORD: USER_PASSWORD,
};
delete configuredEnv.SUPABASE_SERVICE_ROLE_KEY;

const legacyEnv = { ...baseEnv };
for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_APP_EMAIL", "SUPABASE_APP_PASSWORD"]) {
  delete legacyEnv[key];
}

const scenarios = [
  { name: "s1", env: legacyEnv, reset: false },
  { name: "s2", env: configuredEnv },
  { name: "s3a", env: configuredEnv },
  { name: "s3b", env: configuredEnv, reset: false }, // reaproveita sessão e estado do mock
  { name: "s4", env: { ...configuredEnv, SUPABASE_URL: "http://127.0.0.1:54399" } },
  { name: "s5", env: { ...configuredEnv, SUPABASE_APP_PASSWORD: "senha-errada" } },
  { name: "s6", env: configuredEnv },
  { name: "s7", env: configuredEnv },
  { name: "s8", env: configuredEnv },
  { name: "s9", env: { ...configuredEnv, SUPABASE_APP_EMAIL: undefined, SUPABASE_APP_PASSWORD: undefined } },
  // Etapa 3 — teams
  { name: "s10", env: legacyEnv },
  { name: "s11", env: configuredEnv },
  { name: "s12", env: { ...configuredEnv, SUPABASE_URL: "http://127.0.0.1:54399" } },
  { name: "s13", env: { ...configuredEnv, SUPABASE_APP_EMAIL: undefined, SUPABASE_APP_PASSWORD: undefined } },
];
// Remove chaves explicitamente undefined (s9 simula ausência de conta de serviço).
for (const scenario of scenarios) {
  for (const [key, value] of Object.entries(scenario.env)) {
    if (value === undefined) delete scenario.env[key];
  }
}

async function waitForMock(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("mock não iniciou a tempo")), 10000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text.replace(/^/gm, "  [mock] ") + (text.endsWith("\n") ? "" : "\n"));
      if (text.includes("listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(`  [mock:err] ${chunk}`));
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`mock encerrou prematuramente (code ${code})`));
    });
  });
}

async function main() {
  console.log("Compilando o processo main (tsc -p tsconfig.electron.json)...");
  const tsc = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", "-p", "tsconfig.electron.json"],
    { cwd: PROJ, stdio: "inherit" },
  );
  if (tsc.status !== 0) {
    console.error("Compilação falhou — abortando testes.");
    process.exit(1);
  }

  const mock = spawn(
    process.execPath,
    [path.join(__dirname, "mock-supabase.cjs")],
    {
      cwd: PROJ,
      env: { ...process.env, MOCK_PORT: String(PORT), MOCK_USER_EMAIL: USER_EMAIL, MOCK_USER_PASSWORD: USER_PASSWORD },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let exitCode = 0;
  try {
    await waitForMock(mock);
    const results = [];
    for (const scenario of scenarios) {
      if (scenario.reset !== false) {
        await fetch(`${MOCK_URL}/__reset`, { method: "POST" });
      }
      console.log(`\n──────────────────────────────────────────────────────────\n▶ Cenário ${scenario.name}`);
      const run = spawnSync(
        process.execPath,
        [path.join(__dirname, "scenarios.cjs"), scenario.name],
        { cwd: PROJ, env: scenario.env, encoding: "utf8" },
      );
      if (run.stdout) process.stdout.write(run.stdout);
      if (run.stderr) process.stderr.write(run.stderr);
      const ok = run.status === 0;
      results.push({ name: scenario.name, ok });
      if (!ok) exitCode = 1;
    }
    console.log("\n══════════════════ RESUMO ══════════════════");
    for (const result of results) {
      console.log(`${result.ok ? "✅" : "❌"} ${result.name}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? "\nTODOS OS CENÁRIOS PASSARAM." : `\n${failed} cenário(s) falharam.`);
  } catch (err) {
    console.error("Erro no orquestrador:", err.message);
    exitCode = 1;
  } finally {
    mock.kill("SIGKILL");
  }
  process.exit(exitCode);
}

main();

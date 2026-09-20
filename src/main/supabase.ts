import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

/**
 * ============================================================================
 * ETAPA 2 da migração SQLite -> Supabase/PostgreSQL: conexão + Auth.
 * ============================================================================
 * - O SQLite (better-sqlite3 via repository.ts) CONTINUA sendo o banco
 *   principal do aplicativo: teams, matches, championships, fixtures, ranking,
 *   dashboard e game rules permanecem 100% locais. Apenas "players" passa a
 *   ter o Supabase como fonte de verdade (veja players-service.ts), com
 *   espelho local no SQLite para preservar FKs/JOINs das demais entidades.
 * - Este módulo vive exclusivamente no processo MAIN do Electron. As
 *   credenciais nunca são expostas ao renderer.
 * - Usa somente a chave PÚBLICA (anon) + login de uma CONTA DE SERVIÇO do
 *   aplicativo via Supabase Auth (e-mail/senha no .env local). A service_role
 *   NÃO é lida nem utilizada em hipótese alguma.
 * - A ausência de configuração é tolerada: sem .env, o aplicativo funciona
 *   exatamente como antes, 100% SQLite.
 */

export type SupabaseConnectionReason =
  | "connected"
  | "not-configured"
  | "table-missing"
  | "invalid-credentials"
  | "unreachable"
  | "error";

export type SupabaseConnectionStatus = {
  ok: boolean;
  reason: SupabaseConnectionReason;
  message: string;
  /** Amostra de linhas retornada pela consulta de teste (quando houver). */
  rows?: Array<{ id: number }>;
  /** Etapa 2: true quando há sessão ativa da conta de serviço. */
  authenticated?: boolean;
};

export type SupabaseAuthReason =
  | "signed-in"
  | "not-configured"
  | "no-service-account"
  | "invalid-credentials"
  | "unreachable"
  | "error";

export type SupabaseAuthStatus = {
  ok: boolean;
  reason: SupabaseAuthReason;
  message: string;
  email?: string;
};

const LOG_PREFIX = "[supabase]";
const SERVICE_ROLE_ENV_VAR = "SUPABASE_SERVICE_ROLE_KEY";
const APP_EMAIL_ENV_VAR = "SUPABASE_APP_EMAIL";
const APP_PASSWORD_ENV_VAR = "SUPABASE_APP_PASSWORD";
const MIGRATION_FILE = "supabase/migrations/20260827160000_initial_schema.sql";
/** Assinaturas típicas de falha de rede/DNS/timeout (fetch nativo do Node). */
const NETWORK_ERROR_PATTERN =
  /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|aborted|timeout|network/i;
/**
 * Guarda de tempo limite para chamadas HTTP: sem conexão, uma operação não
 * pode travar por minutos — falha rápido e o fallback gracioso assume.
 */
const FETCH_TIMEOUT_MS = 10_000;

let client: SupabaseClient | null = null;
let initialized = false;

/** Indica se a mensagem de erro corresponde a falha de rede/timeout. */
export function isNetworkErrorMessage(message: string): boolean {
  return NETWORK_ERROR_PATTERN.test(message);
}

/**
 * Carrega um arquivo `.env` para o processo principal usando o suporte
 * nativo do Node (`process.loadEnvFile`) — sem dependência extra (dotenv).
 * Variáveis já definidas no ambiente têm precedência sobre o arquivo.
 * Qualquer falha aqui é ignorada de propósito: `.env` é opcional e nunca
 * pode impedir o aplicativo de iniciar.
 */
export function loadDotEnv(rootDir?: string): string | null {
  const candidates = [
    rootDir ? path.join(rootDir, ".env") : null,
    path.join(process.cwd(), ".env"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        process.loadEnvFile(candidate);
        return candidate;
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} não foi possível carregar ${candidate}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

/**
 * Armazenamento de sessão backed por arquivo JSON (pasta userData), para que
 * o login da conta de serviço sobreviva a reinicializações do app sem novo
 * signIn a cada boot. Substitui o localStorage (que não existe no main).
 */
function createFileStorage(file: string) {
  const readAll = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const writeAll = (all: Record<string, string>) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all), "utf8");
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} falha ao persistir a sessão em ${file}:`,
        err instanceof Error ? err.message : err,
      );
    }
  };
  return {
    getItem: (key: string) => readAll()[key] ?? null,
    setItem: (key: string, value: string) => {
      const all = readAll();
      all[key] = value;
      writeAll(all);
    },
    removeItem: (key: string) => {
      const all = readAll();
      delete all[key];
      writeAll(all);
    },
  };
}

/**
 * Cria o cliente Supabase uma única vez (lazy/idempotente), lendo
 * SUPABASE_URL e SUPABASE_ANON_KEY do ambiente (com `.env` como fallback
 * em desenvolvimento). Retorna `null` quando não configurado — o app segue
 * com o SQLite normalmente.
 *
 * `sessionStoragePath` ativa a persistência de sessão (Auth) em arquivo;
 * deve apontar para a pasta userData do Electron (processo main).
 */
export function initSupabase(
  options: { rootDir?: string; sessionStoragePath?: string } = {},
): SupabaseClient | null {
  if (initialized) return client;
  initialized = true;

  loadDotEnv(options.rootDir);

  // Segurança: a service_role jamais deve existir no app distribuído.
  // Este código NÃO a utiliza; o aviso ajuda a removê-la do ambiente.
  if (process.env[SERVICE_ROLE_ENV_VAR]) {
    console.warn(
      `${LOG_PREFIX} AVISO: a variável ${SERVICE_ROLE_ENV_VAR} está presente no ambiente. ` +
        "Ela NÃO é utilizada pelo aplicativo e nunca deve ser empacotada/distribuída — remova-a do .env.",
    );
  }

  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    console.warn(
      `${LOG_PREFIX} Supabase não configurado (SUPABASE_URL e/ou SUPABASE_ANON_KEY ausentes). ` +
        "Copie .env.example para .env e preencha os valores do seu projeto. " +
        "O aplicativo seguirá funcionando normalmente no modo SQLite local.",
    );
    return null;
  }

  try {
    client = createClient(url, anonKey, {
      global: {
        // Timeout: evita travar operações quando não há conectividade.
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
          }),
      },
      auth: options.sessionStoragePath
        ? {
            persistSession: true,
            autoRefreshToken: true,
            storage: createFileStorage(options.sessionStoragePath),
          }
        : {
            // Uso sem persistência (scripts pontuais, testes): sessão só em memória.
            persistSession: false,
            autoRefreshToken: false,
          },
    });
    console.info(`${LOG_PREFIX} cliente criado para ${url} (chave anon pública).`);
    return client;
  } catch (err) {
    client = null;
    console.error(
      `${LOG_PREFIX} falha ao criar o cliente Supabase (verifique SUPABASE_URL/SUPABASE_ANON_KEY):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Retorna o cliente já inicializado, ou `null` se não configurado. */
export function getSupabase(): SupabaseClient | null {
  return client;
}

/** True quando URL + chave anon estão configuradas (cliente criado). */
export function isSupabaseConfigured(): boolean {
  return client !== null;
}

/** Credenciais da conta de serviço do aplicativo (Supabase Auth), se houver. */
function getServiceAccount(): { email: string; password: string } | null {
  const email = process.env[APP_EMAIL_ENV_VAR]?.trim();
  const password = process.env[APP_PASSWORD_ENV_VAR];
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Garante uma sessão 'authenticated' no Supabase usando a conta de serviço
 * do aplicativo (RLS exige esse papel para ler/gravar players).
 *
 * - `force: true` força novo signInWithPassword (usado após sessão recusada).
 * - Nunca lança: devolve status classificado para o chamador decidir.
 */
export async function ensureAuthenticated(
  options: { force?: boolean } = {},
): Promise<SupabaseAuthStatus> {
  const supabase = initSupabase();
  if (!supabase) {
    return {
      ok: false,
      reason: "not-configured",
      message:
        "Supabase não configurado (.env ausente ou incompleto). O aplicativo está no modo SQLite local.",
    };
  }

  const account = getServiceAccount();
  if (!account) {
    return {
      ok: false,
      reason: "no-service-account",
      message:
        `Conta de serviço não configurada (${APP_EMAIL_ENV_VAR}/${APP_PASSWORD_ENV_VAR} ausentes no .env). ` +
        "Leituras de players usarão o espelho local; criações/edições/exclusões ficam bloqueadas até configurar.",
    };
  }

  try {
    if (!options.force) {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data.session) {
        return {
          ok: true,
          reason: "signed-in",
          message: `Sessão Supabase ativa (${account.email}).`,
          email: account.email,
        };
      }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (error) {
      if (/invalid login credentials/i.test(error.message)) {
        return {
          ok: false,
          reason: "invalid-credentials",
          message:
            `Credenciais da conta de serviço recusadas pelo Supabase. Verifique ${APP_EMAIL_ENV_VAR}/${APP_PASSWORD_ENV_VAR} no .env ` +
            "e confirme que o usuário existe em Authentication > Users (com e-mail confirmado).",
        };
      }
      if (isNetworkErrorMessage(error.message)) {
        return {
          ok: false,
          reason: "unreachable",
          message: `Não foi possível alcançar o Supabase para autenticar: ${error.message}`,
        };
      }
      return {
        ok: false,
        reason: "error",
        message: `Erro ao autenticar no Supabase: ${error.message}`,
      };
    }

    return {
      ok: true,
      reason: "signed-in",
      message: `Login da conta de serviço realizado (${account.email}).`,
      email: account.email,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNetworkErrorMessage(message)) {
      return {
        ok: false,
        reason: "unreachable",
        message: `Não foi possível alcançar o Supabase para autenticar: ${message}`,
      };
    }
    return {
      ok: false,
      reason: "error",
      message: `Falha inesperada ao autenticar no Supabase: ${message}`,
    };
  }
}

/**
 * Teste de conexão SOMENTE LEITURA e não destrutivo.
 *
 * - NÃO cria tabelas nem esquemas automaticamente. Se `public.players` não
 *   existir, o resultado informa que é preciso aplicar a migration
 *   {@link MIGRATION_FILE} no SQL Editor.
 * - Etapa 2: quando a conta de serviço está configurada, o teste também
 *   valida o login (RLS exige sessão 'authenticated' para ler players).
 * - Nunca lança exceção: sempre devolve um status classificável, para que o
 *   boot do aplicativo jamais seja interrompido por causa do Supabase.
 */
export async function testSupabaseConnection(): Promise<SupabaseConnectionStatus> {
  const supabase = initSupabase();
  if (!supabase) {
    return {
      ok: false,
      reason: "not-configured",
      message:
        "Supabase não configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY no arquivo .env " +
        "(veja .env.example). O SQLite continua sendo o banco principal do aplicativo.",
    };
  }

  // Autentica a conta de serviço (quando configurada) antes de testar a
  // leitura: com RLS, 'anon' não lê public.players — o app real lê autenticado.
  const auth = await ensureAuthenticated();
  if (!auth.ok && auth.reason !== "no-service-account") {
    const reason: SupabaseConnectionReason =
      auth.reason === "invalid-credentials" || auth.reason === "unreachable"
        ? auth.reason
        : "error";
    return { ok: false, reason, message: auth.message, authenticated: false };
  }

  try {
    const { data, error } = await supabase
      .from("players")
      .select("id")
      .limit(1);

    if (error) {
      // PGRST205: a tabela não existe no schema cache do PostgREST.
      if (error.code === "PGRST205") {
        return {
          ok: false,
          reason: "table-missing",
          message:
            "Conexão e credenciais OK, mas a tabela public.players não existe neste projeto Supabase. " +
            `Aplique a migration ${MIGRATION_FILE} no SQL Editor do Supabase. ` +
            "Nenhuma tabela foi criada automaticamente pelo aplicativo.",
          authenticated: auth.ok,
        };
      }
      // PGRST301 / mensagens de JWT: chave/sessão inválida ou expirada.
      if (error.code === "PGRST301" || /jwt|apikey|unauthorized/i.test(error.message)) {
        return {
          ok: false,
          reason: "invalid-credentials",
          message:
            `Credenciais recusadas pelo Supabase (chave anon ou sessão inválida?): ${error.message}` +
            (error.code ? ` (código: ${error.code})` : ""),
          authenticated: false,
        };
      }
      if (isNetworkErrorMessage(error.message)) {
        return {
          ok: false,
          reason: "unreachable",
          message: `Não foi possível alcançar o Supabase (verifique SUPABASE_URL e a conexão de rede): ${error.message}`,
          authenticated: auth.ok,
        };
      }
      return {
        ok: false,
        reason: "error",
        message: `Erro ao consultar o Supabase: ${error.message} (código: ${error.code || "n/d"})`,
        authenticated: auth.ok,
      };
    }

    const rows = (data ?? []) as Array<{ id: number }>;
    return {
      ok: true,
      reason: "connected",
      message: auth.ok
        ? `Conexão com o Supabase funcionando e autenticada como ${auth.email}: ` +
          `public.players respondeu com ${rows.length} linha(s) de amostra.`
        : rows.length > 0
          ? `Conexão com o Supabase funcionando: public.players retornou ${rows.length} linha(s) de amostra.`
          : "Conexão com o Supabase funcionando: public.players existe e respondeu com 0 linhas. " +
            "Resultado esperado para a chave anon sem conta de serviço configurada (RLS libera leitura apenas ao papel 'authenticated').",
      rows,
      authenticated: auth.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNetworkErrorMessage(message)) {
      return {
        ok: false,
        reason: "unreachable",
        message: `Não foi possível alcançar o Supabase (verifique SUPABASE_URL e a conexão de rede): ${message}`,
        authenticated: auth.ok,
      };
    }
    return {
      ok: false,
      reason: "error",
      message: `Falha inesperada no teste de conexão: ${message}`,
      authenticated: auth.ok,
    };
  }
}

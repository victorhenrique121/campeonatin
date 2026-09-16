import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

/**
 * ============================================================================
 * ETAPA 1 da migração SQLite -> Supabase/PostgreSQL: APENAS CONEXÃO.
 * ============================================================================
 * - O SQLite (better-sqlite3 via repository.ts) CONTINUA sendo o banco
 *   principal do aplicativo. Nada aqui substitui ou remove essa camada.
 * - Este módulo vive exclusivamente no processo MAIN do Electron. As
 *   credenciais nunca são expostas ao renderer.
 * - Usa somente a chave PÚBLICA (anon/publishable). A service_role NÃO é
 *   lida nem utilizada em hipótese alguma (o acesso será protegido por
 *   Supabase Auth + RLS nas próximas etapas).
 * - A ausência de configuração é tolerada: o aplicativo segue funcionando
 *   normalmente apenas com o SQLite.
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
};

const LOG_PREFIX = "[supabase]";
const SERVICE_ROLE_ENV_VAR = "SUPABASE_SERVICE_ROLE_KEY";
const MIGRATION_FILE = "supabase/migrations/20260827160000_initial_schema.sql";
/** Assinaturas típicas de falha de rede/DNS (fetch nativo do Node). */
const NETWORK_ERROR_PATTERN =
  /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|network/i;

let client: SupabaseClient | null = null;
let initialized = false;

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
 * Cria o cliente Supabase uma única vez (lazy/idempotente), lendo
 * SUPABASE_URL e SUPABASE_ANON_KEY do ambiente (com `.env` como fallback
 * em desenvolvimento). Retorna `null` quando não configurado — o app segue
 * com o SQLite normalmente.
 */
export function initSupabase(
  options: { rootDir?: string } = {},
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
        "O aplicativo seguirá funcionando normalmente com o SQLite.",
    );
    return null;
  }

  try {
    client = createClient(url, anonKey, {
      // Etapa 1: apenas conexão/leitura de teste. Auth (login) entra nas
      // próximas etapas; por ora não persistimos sessão no desktop.
      auth: {
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

/**
 * Teste de conexão simples, SOMENTE LEITURA e não destrutivo.
 *
 * - NÃO cria tabelas nem esquemas automaticamente. Se `public.players` não
 *   existir no projeto Supabase, o resultado apenas informa que a etapa
 *   depende de aplicar a migration {@link MIGRATION_FILE} no SQL Editor.
 * - Com a chave anon e as políticas de RLS atuais, um SELECT em `players`
 *   retorna 0 linhas e sem erro (RLS libera leitura apenas para o papel
 *   `authenticated`) — isso também é tratado como conexão OK.
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
        };
      }
      // PGRST301 / mensagens de JWT: chave anon inválida ou expirada.
      if (error.code === "PGRST301" || /jwt|apikey|unauthorized/i.test(error.message)) {
        return {
          ok: false,
          reason: "invalid-credentials",
          message:
            `Credenciais recusadas pelo Supabase (SUPABASE_ANON_KEY inválida/expirada?): ${error.message}` +
            (error.code ? ` (código: ${error.code})` : ""),
        };
      }
      // Falha de rede pode chegar como `error` (supabase-js captura o fetch).
      if (NETWORK_ERROR_PATTERN.test(error.message)) {
        return {
          ok: false,
          reason: "unreachable",
          message: `Não foi possível alcançar o Supabase (verifique SUPABASE_URL e a conexão de rede): ${error.message}`,
        };
      }
      return {
        ok: false,
        reason: "error",
        message: `Erro ao consultar o Supabase: ${error.message} (código: ${error.code || "n/d"})`,
      };
    }

    const rows = (data ?? []) as Array<{ id: number }>;
    return {
      ok: true,
      reason: "connected",
      message:
        rows.length > 0
          ? `Conexão com o Supabase funcionando: public.players retornou ${rows.length} linha(s) de amostra.`
          : "Conexão com o Supabase funcionando: public.players existe e respondeu com 0 linhas. " +
            "Resultado esperado para a chave anon sem sessão de login (RLS libera leitura apenas ao papel 'authenticated').",
      rows,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (NETWORK_ERROR_PATTERN.test(message)) {
      return {
        ok: false,
        reason: "unreachable",
        message: `Não foi possível alcançar o Supabase (verifique SUPABASE_URL e a conexão de rede): ${message}`,
      };
    }
    return {
      ok: false,
      reason: "error",
      message: `Falha inesperada no teste de conexão: ${message}`,
    };
  }
}

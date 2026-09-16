import type { Team } from "../shared/models";
import type { repository } from "./repository";
import { ensureAuthenticated, getSupabase } from "./supabase";

/**
 * ============================================================================
 * ETAPA 3 — Serviço de "teams": leitura do Supabase quando disponível, com
 * fallback gracioso para o catálogo local SQLite.
 * ============================================================================
 * Decisões de projeto (aprovadas pelo usuário):
 *  - teams é um CATÁLOGO GLOBAL E ESTÁTICO: o aplicativo NÃO faz nenhuma
 *    escrita automática no remoto (nem seed, nem sync de boot). O povoamento
 *    e as atualizações do catálogo remoto são MANUAIS, via
 *    `npm run migrate:teams` (scripts/migrate-teams-to-supabase.mjs).
 *  - teams:list lê do Supabase quando configurado e autenticado (RLS exige
 *    sessão 'authenticated'; a conta de serviço admin da Etapa 2 já cobre
 *    teams — nenhuma policy nova é necessária).
 *  - Offline/erro/sem configuração: fallback para o catálogo local (seed do
 *    boot via clubRows.ts no repository, que permanece intocado), preservando
 *    o comportamento exato de antes da Etapa 3.
 *  - O espelho local continua valendo para as FKs de matches
 *    (team1_id/team2_id ON DELETE RESTRICT) e para os JOINs de nomes em
 *    matches:list/dashboard, que seguem 100% SQLite.
 *
 * A assinatura exposta via IPC/preload permanece idêntica:
 *   list(query?) -> Team[]   (canal "teams:list", renderer inalterado)
 */

type Repository = ReturnType<typeof repository>;

/** Linha de public.teams no Supabase (mesmas colunas do modelo local). */
type SupabaseTeamRow = {
  id: number | string;
  name: string;
  league: string;
  country: string;
};

/** Erro devolvido pelo PostgREST (supabase-js). */
type PostgrestErrorLike = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

const LOG_PREFIX = "[teams]";
const TEAM_COLUMNS = "id,name,league,country";

export type TeamsService = {
  /** Lista o catálogo de times (Supabase quando disponível; SQLite como fallback). */
  list(query?: string): Promise<Team[]>;
};

function mapTeam(row: SupabaseTeamRow): Team {
  return {
    id: Number(row.id),
    name: row.name,
    league: row.league,
    country: row.country,
  } as Team;
}

function isPostgrestErrorLike(err: unknown): err is PostgrestErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

function isAuthRejection(err: unknown): boolean {
  return isPostgrestErrorLike(err) && (err.code === "PGRST301" || err.code === "401");
}

/**
 * Remove caracteres reservados da sintaxe `or=()` do PostgREST e coringas,
 * para que a query de busca não quebre a expressão (nem altere o padrão).
 */
function sanitizeSearch(query: string): string {
  return query.replace(/[,()*%]/g, "").trim();
}

export function createTeamsService(repo: Repository): TeamsService {
  /** Garante sessão autenticada; lança erro com mensagem clara quando impossível. */
  async function requireAuth(): Promise<void> {
    const auth = await ensureAuthenticated();
    if (!auth.ok) throw new Error(auth.message);
  }

  /**
   * Executa uma consulta com retry único: se a sessão for recusada (token
   * expirado/revogado), força novo login e tenta outra vez. `make` precisa
   * criar um builder NOVO a cada tentativa (builders são de uso único).
   */
  async function execWithAuthRetry<T>(
    make: () => PromiseLike<{ data: T | null; error: PostgrestErrorLike | null }>,
  ): Promise<T> {
    await requireAuth();
    const run = async (): Promise<T> => {
      const { data, error } = await make();
      if (error) throw error;
      return data as T;
    };
    try {
      return await run();
    } catch (err) {
      if (isAuthRejection(err)) {
        const reauth = await ensureAuthenticated({ force: true });
        if (!reauth.ok) throw new Error(reauth.message);
        try {
          return await run();
        } catch (retryErr) {
          throw retryErr instanceof Error
            ? retryErr
            : new Error(isPostgrestErrorLike(retryErr) ? retryErr.message : String(retryErr));
        }
      }
      throw err instanceof Error
        ? err
        : new Error(isPostgrestErrorLike(err) ? err.message : String(err));
    }
  }

  async function list(query?: string): Promise<Team[]> {
    const supabase = getSupabase();
    if (!supabase) return repo.teams(query); // modo legado: 100% SQLite

    try {
      const rows = await execWithAuthRetry<SupabaseTeamRow[]>(() => {
        const q = sanitizeSearch(query ?? "");
        let builder = supabase.from("teams").select(TEAM_COLUMNS);
        if (q) {
          // Equivalente remoto do LIKE local: busca case-insensitive nos 3 campos.
          builder = builder.or(
            `name.ilike.*${q}*,league.ilike.*${q}*,country.ilike.*${q}*`,
          );
        }
        return builder.order("name", { ascending: true });
      });
      return (rows ?? []).map(mapTeam);
    } catch (err) {
      // Fallback gracioso de LEITURA: catálogo local (seed do boot).
      console.warn(
        `${LOG_PREFIX} Supabase indisponível para leitura — usando catálogo local SQLite.`,
        err instanceof Error ? err.message : err,
      );
      return repo.teams(query);
    }
  }

  return { list };
}
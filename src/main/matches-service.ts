import type Database from "better-sqlite3";

import type { MatchInput } from "../shared/models";
import type { repository } from "./repository";
import { ensureAuthenticated, getSupabase, isNetworkErrorMessage } from "./supabase";

/**
 * ============================================================================
 * ETAPA 4 — Serviço de "matches": padrão HÍBRIDO (decisões aprovadas).
 * ============================================================================
 * Decisões de projeto (aprovadas pelo usuário):
 *  - ESCRITA (save/update/delete): remota primeiro, estrita-online — sem .env
 *    configurado o comportamento é 100% legado (repository); configurado mas
 *    offline/sem conta de serviço, a operação falha com erro amigável e NADA
 *    é gravado localmente (sem divergência), igual à Etapa 2 (players).
 *  - O id da partida nova é GERADO PELO SUPABASE (identity) e a transação
 *    local do repository roda intacta (validações, vínculo de fixture e
 *    advanceKnockout do mata-mata exatamente como hoje); em seguida a linha
 *    local é renumerada para o id remoto, dentro de uma transação.
 *  - LEITURA (matches:list): SEMPRE local (SQLite). O Supabase é destino de
 *    escrita/histórico nesta etapa, não fonte de leitura — assim o rótulo do
 *    campeonato na UI nunca se perde (championship_id fica NULL no remoto até
 *    a Etapa 5 migrar championships). Este serviço NÃO expõe list().
 *  - championship_id: NUNCA é enviado no payload remoto (a FK quebraria —
 *    public.championships está vazia até a Etapa 5). O vínculo real vive no
 *    SQLite; ids preservados permitirão backfill por SQL na Etapa 5.
 *  - syncMirror (boot): importa partidas remotas para o espelho local (mesmos
 *    ids) sem jamais sobrescrever o championship_id LOCAL com o NULL remoto,
 *    e sem deletar linhas locais (upsert-only).
 *  - clearMatches (botão da UI): permanece LOCAL-ONLY nesta etapa (mesmo
 *    precedente do resetArena na Etapa 2). Divergência documentada no
 *    SETUP.md: o histórico remoto é preservado e o syncMirror do próximo boot
 *    reimporta as partidas.
 *  - created_by (coluna NOT NULL remota que não existe local): preenchido com
 *    o uuid da conta de serviço admin da Etapa 2 (RLS de matches já a cobre —
 *    insert/update/delete de admin; nenhuma policy nova).
 *  - repository.ts e championship-service.ts permanecem INTOCADOS; as
 *    assinaturas dos canais IPC são idênticas (renderer/preload inalterados).
 */

type Repository = ReturnType<typeof repository>;

/** Linha de public.matches no Supabase (snake_case). */
type SupabaseMatchRow = {
  id: number | string;
  player1_id: number | string;
  player2_id: number | string;
  team1_id: number | string;
  team2_id: number | string;
  score1: number;
  score2: number;
  championship_id: number | string | null;
  played_at: string | null;
  created_by?: string | null;
};

/** Erro devolvido pelo PostgREST (supabase-js). */
type PostgrestErrorLike = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

const LOG_PREFIX = "[matches]";
const MATCH_COLUMNS =
  "id,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at";

export type MatchesService = {
  /** Registra partida: Supabase primeiro (id remoto) + transação local intacta. */
  save(match: MatchInput): Promise<number>;
  /** Edita partida: Supabase primeiro + atualização local (vínculo preservado). */
  update(match: MatchInput & { id: number }): Promise<number>;
  /** Exclui partida no Supabase e no SQLite (fixtures.match_id -> NULL). */
  remove(id: number): Promise<void>;
  /** Limpeza em massa LOCAL-ONLY (decisão Etapa 4; ver SETUP.md). */
  clear(): void;
  /** Sincroniza o espelho local a partir do Supabase (boot). Retorna nº de linhas. */
  syncMirror(): Promise<number>;
};

/**
 * Converte o played_at vindo do Supabase (timestamptz) para o formato TEXT
 * usado pelo SQLite no app: ISO completo ("...T...Z"), o mesmo que
 * repository.saveMatch grava (new Date().toISOString()).
 */
function normalizePlayedAt(value: unknown): string {
  const fallback = () => new Date().toISOString();
  if (typeof value !== "string" || !value) return fallback();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isPostgrestErrorLike(err: unknown): err is PostgrestErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

/** Converte erros do Supabase em mensagens amigáveis (PT-BR) para a UI. */
function toFriendlyError(err: unknown): Error {
  if (err instanceof Error) {
    if (isNetworkErrorMessage(err.message)) {
      return new Error(
        "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
      );
    }
    return err;
  }
  if (isPostgrestErrorLike(err)) {
    const code = err.code || "";
    const text = `${err.message} ${err.details ?? ""}`;
    if (code === "PGRST205") {
      return new Error(
        "A tabela public.matches não existe no projeto Supabase. " +
          "Aplique a migration supabase/migrations/20260827160000_initial_schema.sql no SQL Editor.",
      );
    }
    if (code === "PGRST301") {
      return new Error(
        "Sessão recusada pelo Supabase. Verifique as credenciais da conta de serviço (SUPABASE_APP_EMAIL/SUPABASE_APP_PASSWORD) no .env.",
      );
    }
    if (code === "42501" || /row-level security/i.test(err.message)) {
      return new Error(
        "Permissão negada pelo Supabase (RLS). Confirme que o profile da conta de serviço tem papel 'admin' (veja supabase/SETUP.md).",
      );
    }
    if (code === "23514") {
      return new Error(
        "Dados da partida recusados pelo Supabase (placar negativo ou jogadores/times repetidos).",
      );
    }
    if (code === "23503") {
      return new Error(
        "Jogador ou time da partida não existe no Supabase (FK). " +
          "Rode `npm run migrate:players` e `npm run migrate:teams` para alinhar o remoto.",
      );
    }
    if (code === "23505") {
      return new Error(
        "Conflito de identificadores no Supabase (sequência de ids desalinhada). " +
          "Rode `npm run migrate:matches` e o setval impresso por ele.",
      );
    }
    if (isNetworkErrorMessage(text)) {
      return new Error(
        "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
      );
    }
    return new Error(
      `Erro no Supabase: ${err.message}${code ? ` (código ${code})` : ""}`,
    );
  }
  return new Error(`Erro inesperado ao acessar o Supabase: ${String(err)}`);
}

function isAuthRejection(err: unknown): boolean {
  return isPostgrestErrorLike(err) && (err.code === "PGRST301" || err.code === "401");
}

export function createMatchesService(
  db: Database.Database,
  repo: Repository,
): MatchesService {
  // ---------------------------------------------------------------------------
  // Espelho local (SQLite): mesmos ids do Supabase. O schema de matches NÃO
  // foi alterado. No UPDATE do upsert, championship_id fica INTENCIONALMENTE
  // de fora: o remoto é sempre NULL nesta etapa e o vínculo real (fixtures,
  // ranking do campeonato, mata-mata) vive apenas no SQLite — a regra de ouro
  // do syncMirror é nunca sobrescrevê-lo com o NULL remoto.
  // ---------------------------------------------------------------------------
  const mirrorUpsert = db.prepare(`
    INSERT INTO matches(id,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at)
    VALUES (@id,@player1_id,@player2_id,@team1_id,@team2_id,@score1,@score2,@championship_id,@played_at)
    ON CONFLICT(id) DO UPDATE SET
      player1_id=excluded.player1_id,
      player2_id=excluded.player2_id,
      team1_id=excluded.team1_id,
      team2_id=excluded.team2_id,
      score1=excluded.score1,
      score2=excluded.score2,
      played_at=excluded.played_at
  `);

  /**
   * Garante sessão autenticada e devolve o uuid da conta de serviço
   * (necessário para created_by, NOT NULL no remoto). Lança erro amigável
   * quando impossível (mesmas mensagens das Etapas 2/3).
   */
  async function requireAuth(force = false): Promise<string> {
    const auth = await ensureAuthenticated(force ? { force: true } : {});
    if (!auth.ok) throw new Error(auth.message);
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase não configurado.");
    const { data, error } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (error || !userId) {
      throw new Error(
        "Sessão da conta de serviço indisponível — não foi possível registrar created_by no Supabase.",
      );
    }
    return userId;
  }

  /**
   * Executa uma chamada Supabase com retry único: se a sessão for recusada
   * (token expirado/revogado), força novo login e tenta outra vez. `make`
   * recebe o uuid da conta de serviço e precisa criar um builder NOVO a cada
   * tentativa (builders são de uso único).
   */
  async function execWithAuthRetry<T>(
    make: (userId: string) => PromiseLike<{ data: T | null; error: PostgrestErrorLike | null }>,
  ): Promise<T> {
    const run = async (userId: string): Promise<T> => {
      const { data, error } = await make(userId);
      if (error) throw error;
      return data as T;
    };
    const userId = await requireAuth();
    try {
      return await run(userId);
    } catch (err) {
      if (isAuthRejection(err)) {
        const freshUserId = await requireAuth(true);
        try {
          return await run(freshUserId);
        } catch (retryErr) {
          throw toFriendlyError(retryErr);
        }
      }
      throw toFriendlyError(err);
    }
  }

  /**
   * Validações locais ANTES da escrita remota — mesmas consultas e mensagens
   * de repository.saveMatch (paridade total de UX). Evita deixar linha órfã
   * no Supabase quando a entrada é inválida (o remoto também barraria via
   * CHECK/FK, mas com mensagem técnica).
   */
  function prevalidateSave(m: MatchInput, championshipId: number | null): void {
    if (!m.player1Id || !m.player2Id || !m.team1Id || !m.team2Id)
      throw new Error("Selecione os dois jogadores e os dois times.");

    if (m.player1Id === m.player2Id || m.team1Id === m.team2Id)
      throw new Error("Escolha jogadores e times diferentes.");

    const player1Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player1Id);
    const player2Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player2Id);
    const team1Exists = db.prepare("SELECT 1 FROM teams WHERE id=?").get(m.team1Id);
    const team2Exists = db.prepare("SELECT 1 FROM teams WHERE id=?").get(m.team2Id);

    if (!player1Exists || !player2Exists)
      throw new Error("Um dos jogadores selecionados não existe.");
    if (!team1Exists || !team2Exists)
      throw new Error("Um dos times selecionados não existe.");

    if (championshipId !== null) {
      const championshipExists = db
        .prepare("SELECT 1 FROM championships WHERE id=?")
        .get(championshipId);
      if (!championshipExists)
        throw new Error("O campeonato selecionado não existe.");

      const fixture = db
        .prepare(
          "SELECT id,stage FROM fixtures WHERE championship_id=? AND match_id IS NULL AND ((player1_id=? AND player2_id=?) OR (player1_id=? AND player2_id=?))",
        )
        .get(championshipId, m.player1Id, m.player2Id, m.player2Id, m.player1Id) as
        | { id: number; stage: string }
        | undefined;
      if (!fixture)
        throw new Error("Este confronto não está pendente neste campeonato.");
      if (fixture.stage !== "league" && m.score1 === m.score2)
        throw new Error("No mata-mata informe um vencedor; empates não são permitidos.");
    }
  }

  /**
   * Renumera a partida local do id gerado pelo SQLite para o id gerado pelo
   * Supabase. PRAGMA foreign_keys=ON e a FK fixtures.match_id não tem
   * ON UPDATE CASCADE (NO ACTION): desvincula, renumera e religa, tudo em
   * uma transação. Com migrate:matches + setval em dia, L normalmente já
   * é igual a R e isto é um no-op.
   */
  function renumberLocalMatch(fromId: number, toId: number): void {
    if (fromId === toId) return;
    const tx = db.transaction(() => {
      const links = db
        .prepare("SELECT id FROM fixtures WHERE match_id=?")
        .all(fromId) as Array<{ id: number }>;
      db.prepare("UPDATE fixtures SET match_id=NULL WHERE match_id=?").run(fromId);
      db.prepare("UPDATE matches SET id=? WHERE id=?").run(toId, fromId);
      const relink = db.prepare("UPDATE fixtures SET match_id=? WHERE id=?");
      for (const link of links) relink.run(toId, link.id);
    });
    tx();
  }

  /**
   * Compensação: se a etapa LOCAL falhar depois que o remoto já gravou,
   * remove a linha remota para não divergir. Best-effort — se a compensação
   * falhar (ex.: rede caiu no meio), o syncMirror do próximo boot trará a
   * partida de volta para o espelho local (sem vínculo de campeonato).
   */
  async function compensateRemoteDelete(remoteId: number): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { error } = await supabase.from("matches").delete().eq("id", remoteId);
      if (error) {
        console.warn(
          `${LOG_PREFIX} compensação remota falhou para id=${remoteId}:`,
          error.message,
        );
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} compensação remota falhou para id=${remoteId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Traduz falha local pós-escrita-remota (colisão de id legado, etc.). */
  function toLocalSaveError(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed: matches\.id|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(message)) {
      return new Error(
        "Conflito de identificadores: o id gerado pelo Supabase já existe no banco local " +
          "(partidas criadas em modo legado?). Rode `npm run migrate:matches` para realinhar " +
          "os ids e tente novamente.",
      );
    }
    return err instanceof Error ? err : new Error(message);
  }

  // ---------------------------------------------------------------------------
  // API pública (mesmas assinaturas dos handlers IPC existentes)
  // ---------------------------------------------------------------------------

  async function save(m: MatchInput): Promise<number> {
    const supabase = getSupabase();
    // MODO LEGADO (sem .env): 100% repository — idêntico ao pré-Etapa 4.
    if (!supabase) return repo.saveMatch(m);

    const championshipId = m.championshipId ? Number(m.championshipId) : null;

    // 1) Validações locais primeiro (paridade de mensagens; evita órfão remoto).
    prevalidateSave(m, championshipId);

    // playedAt único para os dois lados: local e remoto gravam o mesmo valor.
    const playedAt = m.playedAt ?? new Date().toISOString();

    // 2) Escrita remota estrita-online. championship_id NUNCA é enviado
    //    (public.championships está vazia até a Etapa 5 — FK quebraria);
    //    created_by = uuid da conta de serviço (NOT NULL no remoto).

    const result = await execWithAuthRetry<SupabaseMatchRow[] | SupabaseMatchRow>(
      (userId) =>
        supabase
          .from("matches")
          .insert({
            player1_id: m.player1Id,
            player2_id: m.player2Id,
            team1_id: m.team1Id,
            team2_id: m.team2Id,
            score1: m.score1,
            score2: m.score2,
            played_at: playedAt,
            created_by: userId,
          })
          .select(MATCH_COLUMNS),
    );
    const inserted = Array.isArray(result) ? result : result ? [result] : [];
    if (inserted.length === 0)
      throw new Error("O Supabase não retornou a partida criada.");
    const remoteId = Number(inserted[0].id);

    // 3) Transação local INTACTA (repository.saveMatch: fixture pendente,
    //    vínculo fixtures.match_id e advanceKnockout do mata-mata como hoje),
    //    renumerada em seguida para o id gerado pelo Supabase.
    try {
      const localId = repo.saveMatch({
        ...m,
        championshipId: championshipId ?? undefined,
        playedAt,
      });
      renumberLocalMatch(localId, remoteId);
      return remoteId;
    } catch (err) {
      await compensateRemoteDelete(remoteId);
      throw toLocalSaveError(err);
    }
  }

  async function update(m: MatchInput & { id: number }): Promise<number> {
    const supabase = getSupabase();
    // MODO LEGADO (sem .env): 100% repository — idêntico ao pré-Etapa 4.
    if (!supabase) return repo.updateMatch(m);

    // Validações com paridade no repository (mesmas mensagens), ANTES do
    // remoto. O vínculo de campeonato é lido do banco local: a edição nunca
    // o altera (comportamento do updateMatch vigente no main do usuário).
    if (!m.id || !m.player1Id || !m.player2Id || !m.team1Id || !m.team2Id)
      throw new Error("Selecione os dois jogadores e os dois times.");

    if (m.player1Id === m.player2Id || m.team1Id === m.team2Id)
      throw new Error("Escolha jogadores e times diferentes.");

    const player1Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player1Id);
    const player2Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player2Id);
    const team1Exists = db.prepare("SELECT 1 FROM teams WHERE id=?").get(m.team1Id);
    const team2Exists = db.prepare("SELECT 1 FROM teams WHERE id=?").get(m.team2Id);

    if (!player1Exists || !player2Exists)
      throw new Error("Um dos jogadores selecionados não existe.");
    if (!team1Exists || !team2Exists)
      throw new Error("Um dos times selecionados não existe.");

    const existing = db
      .prepare("SELECT id, championship_id FROM matches WHERE id=?")
      .get(m.id) as { id: number; championship_id: number | null } | undefined;
    if (!existing) throw new Error("Partida não encontrada.");

    const playedAt = m.playedAt ?? new Date().toISOString();

    // 1) Remoto primeiro (estrita-online): PATCH parcial — championship_id
    //    não é enviado (permanece NULL no remoto até a Etapa 5).
    const patched = await execWithAuthRetry<SupabaseMatchRow[] | SupabaseMatchRow>(
      () =>
        supabase
          .from("matches")
          .update({
            player1_id: m.player1Id,
            player2_id: m.player2Id,
            team1_id: m.team1Id,
            team2_id: m.team2Id,
            score1: m.score1,
            score2: m.score2,
            played_at: playedAt,
          })
          .eq("id", m.id)
          .select(MATCH_COLUMNS),
    );
    const patchedRows = Array.isArray(patched) ? patched : patched ? [patched] : [];

    if (patchedRows.length === 0) {
      // Partida LEGADA (criada antes da Etapa 4 / do migrate:matches): ainda
      // não existe no remoto. Insere com o mesmo id para convergir — o
      // histórico remoto fica completo sem exigir reimportação manual.
      await execWithAuthRetry<SupabaseMatchRow[] | SupabaseMatchRow>((userId) =>
        supabase
          .from("matches")
          .insert({
            id: m.id,
            player1_id: m.player1Id,
            player2_id: m.player2Id,
            team1_id: m.team1Id,
            team2_id: m.team2Id,
            score1: m.score1,
            score2: m.score2,
            played_at: playedAt,
            created_by: userId,
          })
          .select(MATCH_COLUMNS),
      );
    }

    // 2) Local: repository.updateMatch intacto. O championship_id lido do
    //    banco é repassado explicitamente para que o resultado seja idêntico
    //    nas duas versões vigentes do repository (a do main preserva o valor
    //    do banco; a anterior gravava o valor do input).
    return repo.updateMatch({
      ...m,
      championshipId: existing.championship_id ?? undefined,
      playedAt,
    });
  }

  async function remove(id: number): Promise<void> {
    const supabase = getSupabase();
    // MODO LEGADO (sem .env): 100% repository — idêntico ao pré-Etapa 4.
    if (!supabase) {
      repo.deleteMatch(id);
      return;
    }

    // Paridade de mensagem: "Partida não encontrada." vem do estado LOCAL
    // (matches:list é local — a UI só oferece excluir o que está no SQLite).
    const existing = db.prepare("SELECT id FROM matches WHERE id=?").get(id);
    if (!existing) throw new Error("Partida não encontrada.");

    // Remoto primeiro (estrita-online): sem conexão nada é apagado em lugar
    // nenhum (sem divergência).
    const deleted = await execWithAuthRetry<Array<{ id: number | string }>>(() =>
      supabase.from("matches").delete().eq("id", id).select("id"),
    );
    if (!deleted || deleted.length === 0) {
      // Partida legada (só local): o remoto não tem a linha — segue com a
      // exclusão local (mesmo precedente do remove() de players, Etapa 2).
      console.warn(
        `${LOG_PREFIX} Supabase não retornou linhas ao excluir id=${id} (partida pode ser anterior à Etapa 4). Seguindo com a exclusão local.`,
      );
    }

    // Local: DELETE + fixtures.match_id -> NULL automático (FK SET NULL),
    // devolvendo o confronto ao estado pendente — exatamente como hoje.
    repo.deleteMatch(id);
  }

  function clear(): void {
    // DECISÃO ETAPA 4 (aprovada): limpeza em massa LOCAL-ONLY — mesmo
    // precedente do resetArena na Etapa 2. O histórico remoto é preservado
    // (não implementamos exclusão remota em massa nesta etapa). Consequência
    // documentada no SETUP.md: o syncMirror do próximo boot reimporta as
    // partidas do Supabase para o espelho local.
    repo.clearMatches();
  }

  async function syncMirror(): Promise<number> {
    const supabase = getSupabase();
    if (!supabase) return 0; // modo legado: o banco local É a fonte

    const auth = await ensureAuthenticated();
    if (!auth.ok) return 0; // boot: o teste de conexão já logou o motivo

    let rows: SupabaseMatchRow[];
    try {
      const { data, error } = await supabase
        .from("matches")
        .select(MATCH_COLUMNS)
        .order("id", { ascending: true });
      if (error) throw error;
      rows = (data ?? []) as SupabaseMatchRow[];
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} não foi possível sincronizar o espelho local:`,
        err instanceof Error ? err.message : err,
      );
      return 0;
    }

    if (rows.length === 0) return 0;

    // Upsert-only: NUNCA deleta linhas locais (ausência remota pode ser
    // apenas uma partida legada ainda não convergida; além disso, deletar
    // dispararia o SET NULL de fixtures.match_id). championship_id fica de
    // fora do DO UPDATE — regra de ouro da Etapa 4.
    let synced = 0;
    let skipped = 0;
    const apply = db.transaction(() => {
      for (const row of rows) {
        try {
          mirrorUpsert.run({
            id: Number(row.id),
            player1_id: Number(row.player1_id),
            player2_id: Number(row.player2_id),
            team1_id: Number(row.team1_id),
            team2_id: Number(row.team2_id),
            score1: Number(row.score1),
            score2: Number(row.score2),
            championship_id: row.championship_id == null ? null : Number(row.championship_id),
            played_at: normalizePlayedAt(row.played_at),
          });
          synced += 1;
        } catch (err) {
          // FK RESTRICT local: a linha remota pode referenciar player/time
          // ainda ausente no espelho local — pula a linha sem derrubar o boot.
          skipped += 1;
          console.warn(
            `${LOG_PREFIX} espelho: partida remota id=${row.id} ignorada (vínculo local ausente?).`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    });
    apply();

    if (skipped > 0)
      console.warn(
        `${LOG_PREFIX} espelho: ${skipped} partida(s) remota(s) ignorada(s) por vínculos locais ausentes.`,
      );
    console.info(
      `${LOG_PREFIX} espelho local sincronizado com o Supabase: ${synced} partida(s).`,
    );
    return synced;
  }

  return { save, update, remove, clear, syncMirror };
}
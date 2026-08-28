import fs from "node:fs/promises";

import type {
  Championship,
  Dashboard,
  Match,
  MatchInput,
  Player,
  Team,
} from "../shared/models";
import { supabase } from "./supabaseClient";

export function repository() {
  const throwIfError = (error: { message: string; code?: string } | null) => {
    if (error) throw new Error(error.message);
  };

  const players = async (): Promise<Player[]> => {
    const { data, error } = await supabase
      .from("players")
      .select("id,name,nickname,avatar,created_at")
      .order("name");
    throwIfError(error);
    return (data ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      nickname: row.nickname,
      avatar: row.avatar ?? undefined,
      createdAt: row.created_at,
    }));
  };

  const savePlayer = async (p: Partial<Player>): Promise<Player> => {
    const name = p.name?.trim();
    const nickname = p.nickname?.trim();
    if (!name || !nickname) throw new Error("Nome e apelido são obrigatórios.");

    if (p.id) {
      const { error } = await supabase
        .from("players")
        .update({ name, nickname, avatar: p.avatar ?? null })
        .eq("id", p.id);
      throwIfError(error);
    } else {
      const { error } = await supabase
        .from("players")
        .insert({ name, nickname, avatar: p.avatar ?? null });
      throwIfError(error);
    }

    const { data, error } = await supabase
      .from("players")
      .select("id,name,nickname,avatar,created_at")
      .eq("nickname", nickname)
      .single();
    throwIfError(error);
    if (!data) throw new Error("Jogador não encontrado após salvar.");
    return {
      id: Number(data.id),
      name: data.name,
      nickname: data.nickname,
      avatar: data.avatar ?? undefined,
      createdAt: data.created_at,
    };
  };

  const deletePlayer = async (id: number): Promise<void> => {
    const { error } = await supabase.rpc("delete_player", {
      p_player_id: id,
    });
    throwIfError(error);
  };

  const teams = async (q = ""): Promise<Team[]> => {
    const query = supabase
      .from("teams")
      .select("id,name,league,country")
      .order("name");
    const { data, error } = q.trim()
      ? await query.or(
          `name.ilike.%${q.trim()}%,league.ilike.%${q.trim()}%,country.ilike.%${q.trim()}%`,
        )
      : await query;
    throwIfError(error);
    return (data ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      league: row.league,
      country: row.country,
    }));
  };

  const matches = async (): Promise<Match[]> => {
    const { data, error } = await supabase
      .from("matches")
      .select(`
        id,played_at,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,
        player1:players!matches_player1_id_fkey(name),
        player2:players!matches_player2_id_fkey(name),
        team1:teams!matches_team1_id_fkey(name),
        team2:teams!matches_team2_id_fkey(name),
        championship:championships!matches_championship_id_fkey(name)
      `)
      .order("played_at", { ascending: false });
    throwIfError(error);
    return (data ?? []).map((row) => ({
      id: Number(row.id),
      playedAt: row.played_at,
      player1Id: Number(row.player1_id),
      player2Id: Number(row.player2_id),
      team1Id: Number(row.team1_id),
      team2Id: Number(row.team2_id),
      score1: row.score1,
      score2: row.score2,
      player1: row.player1?.name ?? "",
      player2: row.player2?.name ?? "",
      team1: row.team1?.name ?? "",
      team2: row.team2?.name ?? "",
      championshipId:
        row.championship_id == null ? null : Number(row.championship_id),
      championship: row.championship?.name,
    }));
  };

  const saveMatch = async (m: MatchInput): Promise<number> => {
    if (!m.player1Id || !m.player2Id || !m.team1Id || !m.team2Id)
      throw new Error("Selecione os dois jogadores e os dois times.");
    if (m.player1Id === m.player2Id || m.team1Id === m.team2Id)
      throw new Error("Escolha jogadores e times diferentes.");
    if (m.score1 < 0 || m.score2 < 0)
      throw new Error("Os placares não podem ser negativos.");

    const { data, error } = await supabase.rpc("save_match", {
      p_player1_id: m.player1Id,
      p_player2_id: m.player2Id,
      p_team1_id: m.team1Id,
      p_team2_id: m.team2Id,
      p_score1: m.score1,
      p_score2: m.score2,
      p_championship_id: m.championshipId ?? null,
      p_played_at: m.playedAt ?? new Date().toISOString(),
    });
    throwIfError(error);
    if (data == null) throw new Error("O servidor não retornou o ID da partida.");
    return Number(data);
  };

  const updateMatch = async (m: MatchInput & { id: number }): Promise<number> => {
    if (!m.id || !m.player1Id || !m.player2Id || !m.team1Id || !m.team2Id)
      throw new Error("Selecione os dois jogadores e os dois times.");
    if (m.player1Id === m.player2Id || m.team1Id === m.team2Id)
      throw new Error("Escolha jogadores e times diferentes.");
    if (m.score1 < 0 || m.score2 < 0)
      throw new Error("Os placares não podem ser negativos.");

    const { error } = await supabase
      .from("matches")
      .update({
        player1_id: m.player1Id,
        player2_id: m.player2Id,
        team1_id: m.team1Id,
        team2_id: m.team2Id,
        score1: m.score1,
        score2: m.score2,
        championship_id: m.championshipId ?? null,
        played_at: m.playedAt ?? new Date().toISOString(),
      })
      .eq("id", m.id);
    throwIfError(error);
    return m.id;
  };

  const clearMatches = async (): Promise<void> => {
    const { error } = await supabase
      .from("matches")
      .delete()
      .not("id", "is", null);
    throwIfError(error);
  };

  const ranking = async () => {
    const { data, error } = await supabase
      .from("ranking")
      .select(
        "id,name,played,wins,draws,losses,goalsFor,goalsAgainst,points,winRate,streak",
      );
    throwIfError(error);
    return (data ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      played: Number(row.played),
      wins: Number(row.wins),
      draws: Number(row.draws),
      losses: Number(row.losses),
      goalsFor: Number(row.goalsFor),
      goalsAgainst: Number(row.goalsAgainst),
      points: Number(row.points),
      winRate: Number(row.winRate),
      streak: Number(row.streak),
    }));
  };

  const championships = async (): Promise<Championship[]> => {
    const { data, error } = await supabase
      .from("championships")
      .select("id,name,format,starts_at,status,championship_participants(count)")
      .order("starts_at", { ascending: false });
    throwIfError(error);
    return (data ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      format: row.format,
      startsAt: row.starts_at,
      status: row.status,
      participants: row.championship_participants?.[0]?.count ?? 0,
    }));
  };

  const championshipDetail = async (id: number) => {
    const { data: championshipRow, error: championshipError } = await supabase
      .from("championships")
      .select("id,name,format,starts_at,status,championship_participants(count)")
      .eq("id", id)
      .single();
    throwIfError(championshipError);
    if (!championshipRow) throw new Error("Campeonato não encontrado.");

    const [standingResult, fixturesResult] = await Promise.all([
      supabase
        .from("championship_standings")
        .select("id,name,played,wins,draws,losses,goalsFor,goalsAgainst,points,winRate,streak")
        .eq("championship_id", id)
        .order("points", { ascending: false })
        .order("goalsFor", { ascending: false }),
      supabase
        .from("fixtures")
        .select(`
          id,round_number,stage,player1_id,player2_id,match_id,
          player1:players!fixtures_player1_id_fkey(name),
          player2:players!fixtures_player2_id_fkey(name),
          match:matches!fixtures_match_id_fkey(score1,score2)
        `)
        .eq("championship_id", id)
        .order("round_number")
        .order("id"),
    ]);
    throwIfError(standingResult.error);
    throwIfError(fixturesResult.error);

    const championship: Championship = {
      id: Number(championshipRow.id),
      name: championshipRow.name,
      format: championshipRow.format,
      startsAt: championshipRow.starts_at,
      status: championshipRow.status,
      participants: championshipRow.championship_participants?.[0]?.count ?? 0,
    };

    const standing = (standingResult.data ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      played: Number(row.played),
      wins: Number(row.wins),
      draws: Number(row.draws),
      losses: Number(row.losses),
      goalsFor: Number(row.goalsFor),
      goalsAgainst: Number(row.goalsAgainst),
      points: Number(row.points),
      winRate: Number(row.winRate),
      streak: Number(row.streak),
    }));

    const fixtures = (fixturesResult.data ?? []).map((row) => {
      const match = Array.isArray(row.match) ? row.match[0] : row.match;
      return {
        id: Number(row.id),
        round: row.round_number,
        stage: row.stage,
        player1Id: Number(row.player1_id),
        player2Id: Number(row.player2_id),
        player1: row.player1?.name ?? "",
        player2: row.player2?.name ?? "",
        matchId: row.match_id == null ? undefined : Number(row.match_id),
        score1: match?.score1,
        score2: match?.score2,
      };
    });

    return { championship, standing, fixtures };
  };

  const saveChampionship = async (
    c: Omit<Championship, "id" | "participants"> & { participantIds: number[] },
  ): Promise<Championship> => {
    if (!c.name.trim() || c.participantIds.length < 2)
      throw new Error("Informe nome e pelo menos dois participantes.");
    if (c.format === "groups_knockout")
      throw new Error("Grupos + mata-mata será disponibilizado na próxima etapa.");
    if (c.format === "knockout" && ![2, 4, 8, 16, 32].includes(c.participantIds.length))
      throw new Error("O mata-mata exige 2, 4, 8, 16 ou 32 participantes.");

    const { data, error } = await supabase.rpc("save_championship", {
      p_name: c.name.trim(),
      p_format: c.format,
      p_starts_at: c.startsAt,
      p_participant_ids: c.participantIds,
    });
    throwIfError(error);
    if (data == null) throw new Error("O servidor não retornou o campeonato criado.");

    const result = await championships();
    const created = result.find((item) => item.id === Number(data));
    if (!created) throw new Error("Campeonato criado, mas não pôde ser recarregado.");
    return created;
  };

  const dashboard = async (): Promise<Dashboard> => {
    const [playersResult, matchesResult, rankingResult] = await Promise.all([
      supabase.from("players").select("id", { count: "exact", head: true }),
      supabase.from("matches").select("id", { count: "exact", head: true }),
      ranking(),
    ]);
    throwIfError(playersResult.error);
    throwIfError(matchesResult.error);
    const allMatches = await matches();
    const recent = allMatches.slice(0, 5);

    const usage = new Map<number, { name: string; count: number }>();
    for (const match of allMatches) {
      for (const [id, name] of [
        [match.team1Id, match.team1],
        [match.team2Id, match.team2],
      ] as const) {
        const current = usage.get(id) ?? { name, count: 0 };
        current.count += 1;
        usage.set(id, current);
      }
    }
    const mostUsedTeam = [...usage.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    )[0]?.name;

    return {
      players: playersResult.count ?? 0,
      matches: matchesResult.count ?? 0,
      leader: rankingResult[0],
      mostUsedTeam,
      recent,
      ranking: rankingResult.slice(0, 5),
    };
  };

  const backup = async (destination: string): Promise<string> => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      players: await players(),
      teams: await teams(),
      championships: await championships(),
      matches: await matches(),
    };
    await fs.writeFile(destination, JSON.stringify(snapshot, null, 2), "utf8");
    return destination;
  };

  const restore = async (_source: string): Promise<void> => {
    throw new Error(
      "Restore do banco em nuvem ainda não está disponível nesta etapa. Use a exportação JSON como backup até a migração administrativa ser concluída.",
    );
  };

  return {
    players,
    savePlayer,
    deletePlayer,
    teams,
    saveMatch,
    updateMatch,
    clearMatches,
    matches,
    ranking,
    dashboard,
    championships,
    championshipDetail,
    saveChampionship,
    backup,
    restore,
  };
}

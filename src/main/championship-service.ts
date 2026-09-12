import type Database from "better-sqlite3";

export function updateChampionshipName(
  db: Database.Database,
  id: number,
  name: string,
): void {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Informe um nome para o campeonato.");
  if (!Number.isInteger(id) || id <= 0)
    throw new Error("Campeonato inválido.");

  const result = db
    .prepare("UPDATE championships SET name=? WHERE id=?")
    .run(normalizedName, id);
  if (!result.changes) throw new Error("Campeonato não encontrado.");
}

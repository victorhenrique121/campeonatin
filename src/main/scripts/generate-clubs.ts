import fs from "node:fs";
import csv from "csv-parser";

type Club = {
  name: string;
  league: string;
  country: string;
};

const clubs = new Map<string, Club>();
let lineCount = 0;

fs.createReadStream("src/main/scripts/FC26_20250921.csv")
  .pipe(csv())
  .on("data", (row) => {
    lineCount++;
    const name = row.club_name?.trim();

    if (!name) return;

    if (clubs.has(name)) return;

    clubs.set(name, {
      name,
      league: row.league_name?.trim() ?? "Sem liga",
      country: row.club_country?.trim() ?? row.nation_name?.trim() ?? "",
    });
  })
  .on("error", (error) => {
    console.error("Erro ao ler o arquivo CSV:", error);
  })
  .on("end", () => {
    console.log(`Total de linhas processadas: ${lineCount}`);
    console.log(`Total de clubes únicos encontrados: ${clubs.size}`);

    const rows = [...clubs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (c) =>
          `["${c.name.replace(/"/g, '\\"')}", "${c.league.replace(/"/g, '\\"')}", "${c.country.replace(/"/g, '\\"')}"]`,
      );

    const output = `const clubRows: [string, string, string][] = [
${rows.map((r) => `  ${r},`).join("\n")}
];
`;

    fs.writeFileSync("clubRows.ts", output);

    console.log(`Gerados ${clubs.size} clubes.`);
  });

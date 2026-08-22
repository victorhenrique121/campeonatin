const Database = require("better-sqlite3");
const db = new Database(
  "C:\\Users\\Admin\\AppData\\Roaming\\fc-arena\\fc-arena.sqlite",
);

console.log("\n✓ Verificação do banco de dados\n");

// Verificar estrutura
const columns = db.prepare("PRAGMA table_info(teams)").all();
console.log("Colunas da tabela teams:");
columns.forEach((c) => console.log(`  - ${c.name}`));

// Contar times
const count = db.prepare("SELECT COUNT(*) as cnt FROM teams").get();
console.log(`\n✓ Total de times: ${count.cnt}`);

// Amostra de times
console.log("\nAmostra (primeiros 5 times):");
const teams = db
  .prepare("SELECT id, name, league, country FROM teams LIMIT 5")
  .all();
teams.forEach((t) => {
  console.log(`  ${t.id}. ${t.name} | ${t.league} | ${t.country}`);
});

console.log("\nAmostra (últimos 5 times):");
const lastTeams = db
  .prepare(
    "SELECT id, name, league, country FROM teams ORDER BY id DESC LIMIT 5",
  )
  .all();
lastTeams.reverse().forEach((t) => {
  console.log(`  ${t.id}. ${t.name} | ${t.league} | ${t.country}`);
});

db.close();
console.log("\n✓ Banco verificado com sucesso!\n");

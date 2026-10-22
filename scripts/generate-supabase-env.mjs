import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = path.resolve(".env");
const outputPath = path.resolve("supabase.env");
const publicKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

function readValue(envContents, key) {
  const match = envContents.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  if (!match) return null;

  const value = match[1].trim();
  if (!value) return null;

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

const envContents = await readFile(sourcePath, "utf8");
const values = publicKeys.map((key) => [key, readValue(envContents, key)]);
const missingKeys = values.filter(([, value]) => !value).map(([key]) => key);

if (missingKeys.length > 0) {
  throw new Error(`Não foi possível gerar supabase.env: faltam ${missingKeys.join(", ")} no .env.`);
}

const publicEnv = [
  "# Gerado durante o empacotamento. Não adicione segredos a este arquivo.",
  ...values.map(([key, value]) => `${key}=${value}`),
  "",
].join("\n");

await writeFile(outputPath, publicEnv, "utf8");
console.log("Arquivo público de configuração gerado para o pacote.");

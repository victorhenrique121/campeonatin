import { createClient } from '@supabase/supabase-js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Carrega as variáveis do .env
if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const appEmail = process.env.SUPABASE_APP_EMAIL;
const appPassword = process.env.SUPABASE_APP_PASSWORD;

if (!supabaseUrl || !supabaseAnonKey || !appEmail || !appPassword) {
  console.error("❌ [Erro] SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_APP_EMAIL e SUPABASE_APP_PASSWORD precisam estar no .env");
  process.exit(1);
}

// Lista de locais onde o Electron e a aplicação costumam criar o arena.db
const possiblePaths = [
  path.join(process.cwd(), 'arena.db'),
  path.join(process.cwd(), 'src', 'main', 'arena.db'),
  path.join(process.env.APPDATA || '', 'fc-arena', 'arena.db'),
  path.join(process.env.APPDATA || '', 'campeonatin', 'arena.db'),
  path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'fc-arena', 'arena.db'),
];

const dbPath = possiblePaths.find((p) => fs.existsSync(p));

if (!dbPath) {
  console.error("❌ Banco de dados arena.db não foi encontrado nos seguintes locais:");
  possiblePaths.forEach((p) => console.error(`  - ${p}`));
  console.error("\nAbra a aplicação desktop (npm run dev), crie ao menos um registro e tente novamente.");
  process.exit(1);
}

console.log(`📁 Banco SQLite encontrado em: ${dbPath}`);
const db = new Database(dbPath);
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runMigration() {
  console.log("🔐 Efetuando login no Supabase...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: appEmail,
    password: appPassword,
  });

  if (authError) {
    console.error("❌ Falha na autenticação do Supabase:", authError.message);
    process.exit(1);
  }

  console.log(`✅ Autenticado como ${authData.user.email}`);

  try {
    const championships = db.prepare("SELECT * FROM championships").all();
    console.log(`🏆 Encontrados ${championships.length} campeonatos no SQLite local...`);

    if (championships.length === 0) {
      console.log("ℹ️ Nenhum campeonato encontrado no banco local para enviar.");
      return;
    }

    const formattedChampionships = championships.map((c) => ({
      id: c.id,
      name: c.name,
      format: c.format || 'league',
      mode: c.mode || 'classic',
      mutator: c.mutator || null,
      starts_at: c.starts_at || c.startsAt || new Date().toISOString(),
      status: c.status || 'draft',
      created_at: c.created_at || new Date().toISOString(),
    }));

    const { error: sendError } = await supabase
      .from('championships')
      .upsert(formattedChampionships, { onConflict: 'id' });

    if (sendError) {
      throw new Error(`Erro ao enviar campeonatos: ${sendError.message}`);
    }

    console.log(`🚀 Sucesso! ${championships.length} campeonatos enviados/sincronizados no Supabase.`);
  } catch (err) {
    console.error("❌ Falha durante o envio:", err.message);
  } finally {
    db.close();
  }
}

runMigration();
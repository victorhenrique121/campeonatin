import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { app } from 'electron';
import path from 'node:path';

// Carrega as variáveis do arquivo .env que está na raiz do projeto
dotenv.config({ path: path.join(app.getAppPath(), '.env') });
// Tenta carregar também no diretório atual de execução por segurança
if (!process.env.SUPABASE_URL) dotenv.config(); 

const supabaseUrl = 'https://mirnheuycclmxlhtscxc.supabase.co';
const supabaseKey = process.env['sb_publishable_VIdzdPOF-riKdxoZJWL1hQ_MCYXdV8p'];

if (!supabaseUrl || !supabaseKey) {
  console.error('[supabase] Erro: SUPABASE_URL ou SUPABASE_ANON_KEY não foram encontrados. Verifique seu arquivo .env');
} else {
  // Função para testar a conexão assim que o app abrir
  async function testConnection() {
    try {
      // Tenta fazer uma consulta simples na tabela players
      const { error } = await supabase.from('players').select('*').limit(1);

      if (error) {
        // Código 42P01 do PostgreSQL significa "undefined_table" (tabela não existe)
        if (error.code === '42P01') { 
          console.log('[supabase] Teste de conexão (table-missing)');
        } else {
          console.error('[supabase] Erro na conexão:', error.message);
        }
      } else {
        console.log('[supabase] Teste de conexão (connected)');
      }
    } catch (err) {
      console.error('[supabase] Erro inesperado ao tentar conectar:', err);
    }
  }

  testConnection();
}

// Inicializa o cliente do Supabase no escopo do módulo.
export const supabase = createClient(supabaseUrl, supabaseKey!);
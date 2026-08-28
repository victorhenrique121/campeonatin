import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase não configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY no ambiente do FC Arena.",
  );
}

/**
 * Client used by the Electron main process.
 *
 * This must use only the public/publishable (anon) key. Authorization is
 * enforced by Supabase Auth + PostgreSQL RLS; a service-role key must never be
 * shipped inside the Electron application.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
// VITE_SUPABASE_ANON_KEY remains only for projects not yet migrated to publishable keys.
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

export function getSupabaseClient() {
  if (!url || !publishableKey) throw new Error("missing_supabase_configuration");
  return createClient(url, publishableKey);
}

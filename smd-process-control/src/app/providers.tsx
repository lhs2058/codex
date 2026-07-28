import type { PropsWithChildren } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import { getSupabaseClient } from "../data/supabase";

export function AppProviders({ children }: PropsWithChildren) {
  return <AuthProvider client={getSupabaseClient() as unknown as Parameters<typeof AuthProvider>[0]["client"]}>{children}</AuthProvider>;
}

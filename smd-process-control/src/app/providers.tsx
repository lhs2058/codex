import type { PropsWithChildren } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import { getSupabaseClient } from "../data/supabase";

export function AppProviders({ children }: PropsWithChildren) {
  if (import.meta.env.VITE_RESPONSIVE_TEST === "true") return <>{children}</>;
  return <AuthProvider client={getSupabaseClient() as unknown as Parameters<typeof AuthProvider>[0]["client"]}>{children}</AuthProvider>;
}

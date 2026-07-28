import type { PropsWithChildren } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import { getSupabaseClient } from "../data/supabase";
import { responsiveFixturesEnabled } from "./responsive-test";

export function AppProviders({ children }: PropsWithChildren) {
  const responsiveTest = responsiveFixturesEnabled(
    import.meta.env.DEV,
    import.meta.env.VITE_RESPONSIVE_TEST === "true",
  );
  if (responsiveTest) return <>{children}</>;
  return <AuthProvider client={getSupabaseClient() as unknown as Parameters<typeof AuthProvider>[0]["client"]}>{children}</AuthProvider>;
}

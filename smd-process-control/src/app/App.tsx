import { useAuthState } from "../auth/AuthProvider";
import { I18nProvider } from "../i18n";
import { AppRoutes } from "./routes";
import { responsiveFixturesEnabled } from "./responsive-test";
import type { Session } from "@supabase/supabase-js";

export function App() {
  const actualAuth = useAuthState();
  const responsiveTest = responsiveFixturesEnabled(
    import.meta.env.DEV,
    import.meta.env.VITE_RESPONSIVE_TEST === "true",
  );
  const requestedLanguage = globalThis.location?.search.includes("language=vi") ? "vi" : "ko";
  const auth = responsiveTest
    ? {
        status: "ready" as const,
        session: { user: { id: "responsive-test-user" } } as Session,
        profile: { role: "admin" as const, isActive: true, language: requestedLanguage as "ko" | "vi" },
      }
    : actualAuth;
  return <I18nProvider
    profileLanguage={auth.profile?.language}
    onLanguageChange={auth.session ? auth.setLanguage : undefined}
  >
    <AppRoutes auth={auth} responsiveTest={responsiveTest} />
  </I18nProvider>;
}

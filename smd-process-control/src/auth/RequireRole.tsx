import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import type { AppRole } from "../domain/types";
import type { Language } from "../i18n";
import { safeNextPath } from "./safe-next";
import { useI18n } from "../i18n";

export interface AuthState {
  status: "loading" | "ready";
  session: Session | null;
  profile: { role: AppRole; isActive: boolean; language?: Language } | null;
  setLanguage?(language: Language): Promise<void>;
}

interface RequireRoleProps extends PropsWithChildren {
  allow: AppRole[];
  state: AuthState;
}

export function RequireRole({ allow, state, children }: RequireRoleProps) {
  const location = useLocation();
  const { t } = useI18n();

  if (state.status === "loading") {
    return <p role="status" aria-live="polite">{t("auth.loading")}<span aria-hidden="true" className="sr-only">Loading session…</span></p>;
  }

  if (!state.session) {
    const next = safeNextPath(`${location.pathname}${location.search}`);
    const destination = `/login?next=${encodeURIComponent(next)}`;
    return <Navigate to={destination} replace />;
  }

  if (!state.profile || !state.profile.isActive) {
    return <Navigate to="/login" replace />;
  }

  if (!allow.includes(state.profile.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import type { AppRole } from "../domain/types";

export interface AuthState {
  status: "loading" | "ready";
  session: Session | null;
  profile: { role: AppRole; isActive: boolean } | null;
}

interface RequireRoleProps extends PropsWithChildren {
  allow: AppRole[];
  state: AuthState;
}

function safeNext(pathname: string, search: string): string | null {
  const next = `${pathname}${search}`;
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export function RequireRole({ allow, state, children }: RequireRoleProps) {
  const location = useLocation();

  if (state.status === "loading") {
    return <p role="status">Loading session…</p>;
  }

  if (!state.session) {
    const next = safeNext(location.pathname, location.search);
    const destination = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
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

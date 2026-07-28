import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { Session } from "@supabase/supabase-js";
import type { AppRole } from "../domain/types";
import type { AuthState } from "./RequireRole";

type Profile = { role: AppRole; is_active: boolean };
type ProfileResult = { data: Profile | null; error: unknown | null };

export interface SessionAuthClient {
  auth: {
    getSession(): Promise<{ data: { session: Session | null }; error: unknown | null }>;
    onAuthStateChange(callback: (_event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<unknown>;
  };
  from(table: "profiles"): { select(columns: string): { eq(column: string, value: string): { single(): PromiseLike<ProfileResult> } } };
}

const AuthContext = createContext<AuthState>({ status: "loading", session: null, profile: null });

export function AuthProvider({ client, children }: PropsWithChildren<{ client: SessionAuthClient }>) {
  const [state, setState] = useState<AuthState>({ status: "loading", session: null, profile: null });

  useEffect(() => {
    let disposed = false;
    const resolveSession = async (session: Session | null) => {
      if (!session) {
        if (!disposed) setState({ status: "ready", session: null, profile: null });
        return;
      }
      if (!disposed) setState({ status: "loading", session: null, profile: null });
      const { data, error } = await client.from("profiles").select("role,is_active").eq("id", session.user.id).single();
      if (disposed) return;
      if (error || !data || !data.is_active) {
        setState({ status: "ready", session: null, profile: null });
        await client.auth.signOut();
        return;
      }
      setState({ status: "ready", session, profile: { role: data.role, isActive: true } });
    };

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => { void resolveSession(session); });
    void client.auth.getSession().then(({ data }) => resolveSession(data.session)).catch(() => resolveSession(null));
    return () => { disposed = true; subscription.unsubscribe(); };
  }, [client]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState(): AuthState {
  return useContext(AuthContext);
}

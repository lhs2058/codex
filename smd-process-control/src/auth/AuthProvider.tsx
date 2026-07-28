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
    let mounted = true;
    let generation = 0;
    const current = (requestGeneration: number) => mounted && generation === requestGeneration;
    const resolveProfile = async (session: Session, requestGeneration: number) => {
      const { data, error } = await client.from("profiles").select("role,is_active").eq("id", session.user.id).single();
      if (!current(requestGeneration)) return;
      if (error || !data || !data.is_active) {
        setState({ status: "ready", session: null, profile: null });
        void Promise.resolve(client.auth.signOut()).catch(() => undefined);
        return;
      }
      setState({ status: "ready", session, profile: { role: data.role, isActive: true } });
    };

    const beginSession = (session: Session | null) => {
      const requestGeneration = ++generation;
      if (!session) {
        if (current(requestGeneration)) setState({ status: "ready", session: null, profile: null });
        return;
      }
      setState({ status: "loading", session: null, profile: null });
      void resolveProfile(session, requestGeneration);
    };

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => { beginSession(session); });
    const initialGeneration = generation;
    void client.auth.getSession().then(({ data }) => {
      if (mounted && generation === initialGeneration) beginSession(data.session);
    }).catch(() => {
      if (mounted && generation === initialGeneration) beginSession(null);
    });
    return () => { mounted = false; generation += 1; subscription.unsubscribe(); };
  }, [client]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState(): AuthState {
  return useContext(AuthContext);
}

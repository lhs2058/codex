import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
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
  const generation = useRef(0);

  useEffect(() => {
    let mounted = true;
    const initialToken = ++generation.current;
    const current = (token: number) => mounted && generation.current === token;
    const clearAndSignOut = (token: number) => {
      if (!current(token)) return;
      setState({ status: "ready", session: null, profile: null });
      void Promise.resolve().then(() => client.auth.signOut()).catch(() => undefined);
    };
    const resolveProfile = (session: Session, token: number) => {
      void Promise.resolve().then(() => {
        if (!current(token)) return null;
        return client.from("profiles").select("role,is_active").eq("id", session.user.id).single();
      }).then((result) => {
        if (!current(token) || !result) return;
        if (result.error || !result.data || !result.data.is_active) {
          clearAndSignOut(token);
          return;
        }
        setState({ status: "ready", session, profile: { role: result.data.role, isActive: true } });
      }).catch(() => {
        clearAndSignOut(token);
      });
    };

    const beginSession = (session: Session | null, token: number) => {
      if (!current(token)) return;
      if (!session) {
        setState({ status: "ready", session: null, profile: null });
        return;
      }
      setState({ status: "loading", session: null, profile: null });
      resolveProfile(session, token);
    };

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const token = ++generation.current;
      beginSession(session, token);
    });
    void client.auth.getSession().then(({ data }) => {
      if (current(initialToken)) beginSession(data.session, initialToken);
    }).catch(() => {
      if (current(initialToken)) beginSession(null, initialToken);
    });
    return () => { mounted = false; generation.current += 1; subscription.unsubscribe(); };
  }, [client]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState(): AuthState {
  return useContext(AuthContext);
}

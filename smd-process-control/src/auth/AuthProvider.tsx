import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import type { Session } from "@supabase/supabase-js";
import type { AppRole } from "../domain/types";
import type { Language } from "../i18n";
import type { AuthState } from "./RequireRole";

type Profile = { role: AppRole; is_active: boolean; language?: Language | null };
type ProfileResult = { data: Profile | null; error: unknown | null };
type RpcResult = { data?: unknown; error: unknown | null };

export interface SessionAuthClient {
  auth: {
    getSession(): Promise<{ data: { session: Session | null }; error: unknown | null }>;
    onAuthStateChange(callback: (_event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<unknown>;
  };
  from(table: "profiles"): {
    select(columns: string): { eq(column: string, value: string): { single(): PromiseLike<ProfileResult> } };
  };
  rpc?(name: "set_my_language", args: { new_language: Language }): PromiseLike<RpcResult>;
}

const AuthContext = createContext<AuthState>({ status: "loading", session: null, profile: null });

export function AuthProvider({ client, children }: PropsWithChildren<{ client: SessionAuthClient }>) {
  const [state, setState] = useState<AuthState>({ status: "loading", session: null, profile: null });
  const generation = useRef(0);
  const sessionUserId = useRef<string | null>(null);
  const latestSession = useRef<Session | null>(null);

  useEffect(() => {
    let mounted = true;
    const initialToken = ++generation.current;
    const current = (token: number) => mounted && generation.current === token;
    const clearAndSignOut = (token: number) => {
      if (!current(token)) return;
      sessionUserId.current = null;
      latestSession.current = null;
      setState({ status: "ready", session: null, profile: null });
      void Promise.resolve().then(() => client.auth.signOut()).catch(() => undefined);
    };
    const resolveProfile = (session: Session, token: number) => {
      void Promise.resolve().then(() => {
        if (!current(token)) return null;
        return client.from("profiles").select("role,is_active,language").eq("id", session.user.id).single();
      }).then((result) => {
        if (!current(token) || !result) return;
        if (result.error || !result.data || !result.data.is_active) {
          clearAndSignOut(token);
          return;
        }
        setState({
          status: "ready",
          session: latestSession.current?.user.id === session.user.id ? latestSession.current : session,
          profile: {
            role: result.data.role,
            isActive: true,
            language: result.data.language === "vi" ? "vi" : "ko",
          },
        });
      }).catch(() => {
        clearAndSignOut(token);
      });
    };

    const beginSession = (session: Session | null, token: number) => {
      if (!current(token)) return;
      if (!session) {
        sessionUserId.current = null;
        latestSession.current = null;
        setState({ status: "ready", session: null, profile: null });
        return;
      }
      sessionUserId.current = session.user.id;
      latestSession.current = session;
      setState({ status: "loading", session: null, profile: null });
      resolveProfile(session, token);
    };

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session && sessionUserId.current === session.user.id) {
        latestSession.current = session;
        setState((currentState) => currentState.status === "ready" && currentState.session?.user.id === session.user.id
          ? { ...currentState, session }
          : currentState);
        return;
      }
      const token = ++generation.current;
      beginSession(session, token);
    });
    void client.auth.getSession().then(({ data }) => {
      if (current(initialToken)) beginSession(data.session, initialToken);
    }).catch(() => {
      if (current(initialToken)) beginSession(null, initialToken);
    });
    return () => {
      mounted = false;
      generation.current += 1;
      sessionUserId.current = null;
      latestSession.current = null;
      subscription.unsubscribe();
    };
  }, [client]);

  const setLanguage = useCallback(async (language: Language) => {
    const currentSession = state.session;
    const currentProfile = state.profile;
    if (!currentSession || !currentProfile) return;
    setState((current) => current.profile
      ? { ...current, profile: { ...current.profile, language } }
      : current);
    try {
      if (!client.rpc) throw new Error("language_rpc_unavailable");
      const result = await client.rpc("set_my_language", { new_language: language });
      if (result.error) throw result.error;
    } catch (error) {
      setState((current) => current.profile
        ? { ...current, profile: { ...current.profile, language: currentProfile.language } }
        : current);
      throw error;
    }
  }, [client, state.profile, state.session]);

  const value = useMemo(() => ({ ...state, setLanguage }), [setLanguage, state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState(): AuthState {
  return useContext(AuthContext);
}

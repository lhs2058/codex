import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { AuthProvider, type SessionAuthClient, useAuthState } from "../../src/auth/AuthProvider";

const session = { user: { id: "user-1" } } as never;
const sessionA = { user: { id: "user-a" } } as never;
const sessionB = { user: { id: "user-b" } } as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function raceClient() {
  let listener: (_event: string, next: typeof session | null) => void = () => undefined;
  const profiles = new Map<string, ReturnType<typeof deferred<{ data: { role: "admin" | "operator" | "viewer"; is_active: boolean } | null; error: unknown | null }>>>();
  const unsubscribe = vi.fn();
  const client: SessionAuthClient = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn((callback) => { listener = callback; return { data: { subscription: { unsubscribe } } }; }),
      signOut: vi.fn(),
    },
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn((_column, id) => ({ single: () => profiles.get(id)!.promise })) }) }),
  };
  return { client, profiles, emit: (event: string, next: typeof session | null) => listener(event, next), unsubscribe };
}

function StateProbe() {
  const state = useAuthState();
  return <output data-testid="auth-state">{`${state.status}:${state.session?.user.id ?? "none"}:${state.profile?.role ?? "none"}`}</output>;
}

function LanguageStateProbe() {
  const state = useAuthState();
  return <button type="button" onClick={() => void state.setLanguage?.("vi")}>
    {state.profile?.language ?? "none"}
  </button>;
}

function clientFor(profile: { role: "admin" | "operator" | "viewer"; is_active: boolean; language?: "ko" | "vi" } | null): SessionAuthClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: profile, error: profile ? null : { message: "missing" } }) }) }) }),
  };
}

describe("application authentication", () => {
  it("persists the signed-in user's language through the hardened self-service RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      ...clientFor({ role: "viewer", is_active: true, language: "ko" }),
      rpc,
    } as SessionAuthClient;
    render(<AuthProvider client={client}><LanguageStateProbe /></AuthProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "ko" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_my_language", { new_language: "vi" }));
    expect(screen.getByRole("button", { name: "vi" })).toBeInTheDocument();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("rolls back the shell picker and announces a translated error when the RPC fails", async () => {
    const client = {
      ...clientFor({ role: "viewer", is_active: true, language: "ko" }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "network" } }),
    } as SessionAuthClient;
    render(<MemoryRouter><AuthProvider client={client}><App /></AuthProvider></MemoryRouter>);
    const picker = await screen.findByLabelText("언어");

    fireEvent.change(picker, { target: { value: "vi" } });

    await waitFor(() => expect(picker).toHaveValue("ko"));
    expect(screen.getByText(/언어 설정을 저장하지 못했습니다/)).toHaveAttribute("role", "alert");
  });

  it("restores an active admin profile before rendering the protected admin route", async () => {
    render(<MemoryRouter initialEntries={["/admin"]}><AuthProvider client={clientFor({ role: "admin", is_active: true })}><App /></AuthProvider></MemoryRouter>);
    expect(screen.getByText("Loading session…")).toBeInTheDocument();
    await expect(screen.findByText("Admin workspace")).resolves.toBeInTheDocument();
  });

  it("signs out a stale profile and sends it to login without showing protected content", async () => {
    const client = clientFor(null);
    render(<MemoryRouter initialEntries={["/"]}><AuthProvider client={client}><App /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인" })).toBeInTheDocument());
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(screen.queryByText("Production workspace")).not.toBeInTheDocument();
  });

  it("ignores an old profile result after a newer signed-out event", async () => {
    const race = raceClient();
    const oldProfile = deferred<{ data: { role: "admin"; is_active: boolean }; error: null }>();
    race.profiles.set("user-a", oldProfile);
    render(<MemoryRouter initialEntries={["/admin"]}><AuthProvider client={race.client}><App /><StateProbe /></AuthProvider></MemoryRouter>);
    await screen.findByRole("heading", { name: "로그인" });
    await act(async () => { race.emit("SIGNED_IN", sessionA); });
    await act(async () => { race.emit("SIGNED_OUT", null); });
    await act(async () => { oldProfile.resolve({ data: { role: "admin", is_active: true }, error: null }); });
    expect(screen.queryByText("Admin workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "로그인" })).toBeInTheDocument();
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:none:none");
  });

  it("keeps session B when session A's profile resolves late", async () => {
    const race = raceClient();
    const profileA = deferred<{ data: { role: "admin"; is_active: boolean }; error: null }>();
    const profileB = deferred<{ data: { role: "operator"; is_active: boolean }; error: null }>();
    race.profiles.set("user-a", profileA);
    race.profiles.set("user-b", profileB);
    render(<MemoryRouter initialEntries={["/admin"]}><AuthProvider client={race.client}><App /><StateProbe /></AuthProvider></MemoryRouter>);
    await screen.findByRole("heading", { name: "로그인" });
    await act(async () => { race.emit("SIGNED_IN", sessionA); race.emit("TOKEN_REFRESHED", sessionB); });
    await act(async () => { profileB.resolve({ data: { role: "operator", is_active: true }, error: null }); });
    await act(async () => { profileA.resolve({ data: { role: "admin", is_active: true }, error: null }); });
    expect(screen.queryByText("Admin workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "로그인" })).toBeInTheDocument();
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:user-b:operator");
  });

  it("keeps a ready session visible when Supabase repeats an auth event for the same user", async () => {
    let listener: (_event: string, next: typeof session | null) => void = () => undefined;
    const duplicateProfile = deferred<{ data: { role: "admin"; is_active: boolean }; error: null }>();
    const single = vi.fn()
      .mockResolvedValueOnce({ data: { role: "admin", is_active: true }, error: null })
      .mockReturnValueOnce(duplicateProfile.promise);
    const client: SessionAuthClient = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        onAuthStateChange: vi.fn((callback) => {
          listener = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
        signOut: vi.fn(),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single }),
        }),
      }),
    };

    render(<AuthProvider client={client}><StateProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:user-1:admin"));

    await act(async () => { listener("SIGNED_IN", session); });

    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:user-1:admin");
    expect(single).toHaveBeenCalledOnce();
  });

  it("unsubscribes and ignores a profile result after unmount", async () => {
    const race = raceClient();
    const profile = deferred<{ data: { role: "admin"; is_active: boolean }; error: null }>();
    race.profiles.set("user-a", profile);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<MemoryRouter initialEntries={["/admin"]}><AuthProvider client={race.client}><App /></AuthProvider></MemoryRouter>);
    await screen.findByRole("heading", { name: "로그인" });
    await act(async () => { race.emit("SIGNED_IN", sessionA); });
    view.unmount();
    await act(async () => { profile.resolve({ data: { role: "admin", is_active: true }, error: null }); });
    expect(race.unsubscribe).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("ignores delayed initial session restoration after a synchronous auth callback", async () => {
    const initial = deferred<{ data: { session: typeof session | null }; error: null }>();
    const profileB = deferred<{ data: { role: "operator"; is_active: boolean }; error: null }>();
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn((_column, id) => ({ single: () => id === "user-b" ? profileB.promise : Promise.resolve({ data: { role: "admin", is_active: true }, error: null }) })) }) });
    const client: SessionAuthClient = {
      auth: {
        getSession: vi.fn().mockReturnValue(initial.promise),
        onAuthStateChange: vi.fn((callback) => { callback("SIGNED_IN", sessionB); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
        signOut: vi.fn(),
      },
      from,
    };
    render(<MemoryRouter initialEntries={["/admin"]}><AuthProvider client={client}><App /><StateProbe /></AuthProvider></MemoryRouter>);
    await act(async () => { profileB.resolve({ data: { role: "operator", is_active: true }, error: null }); });
    await act(async () => { initial.resolve({ data: { session: sessionA }, error: null }); });
    expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:user-b:operator");
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("clears and signs out when a current profile request rejects", async () => {
    const signOut = vi.fn();
    const client: SessionAuthClient = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }), onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }), signOut },
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: () => Promise.reject(new Error("network")) }) }) }),
    };
    render(<MemoryRouter initialEntries={["/admin"]}><AuthProvider client={client}><App /><StateProbe /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("ready:none:none"));
    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText("Admin workspace")).not.toBeInTheDocument();
  });

  it("does not load a profile for an auth callback delivered after unmount", async () => {
    let callback: (_event: string, next: typeof session | null) => void = () => undefined;
    const from = vi.fn();
    const client: SessionAuthClient = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }), onAuthStateChange: vi.fn((next) => { callback = next; return { data: { subscription: { unsubscribe: vi.fn() } } }; }), signOut: vi.fn() },
      from,
    };
    const view = render(<MemoryRouter><AuthProvider client={client}><App /></AuthProvider></MemoryRouter>);
    view.unmount();
    await act(async () => { callback("SIGNED_IN", sessionA); });
    expect(from).not.toHaveBeenCalled();
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RequireRole, type AuthState } from "../../src/auth/RequireRole";
import { signInWithEmployeeId, type AuthClient } from "../../src/auth/auth-service";
import { safeNextPath } from "../../src/auth/safe-next";

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function guard(state: AuthState, allow: AuthState["profile"] extends infer _ ? Array<"operator" | "admin" | "viewer"> : never = ["admin"]) {
  return (
    <MemoryRouter initialEntries={["/admin?tab=users"]}>
      <Routes>
        <Route path="/login" element={<Location />} />
        <Route path="/" element={<Location />} />
        <Route path="/admin" element={<RequireRole allow={allow} state={state}><div>admin page</div></RequireRole>} />
      </Routes>
    </MemoryRouter>
  );
}

const session = { access_token: "token", user: { id: "user-1" } } as never;

describe("signInWithEmployeeId", () => {
  it("signs in with the generated identifier and returns a session for an active profile", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const single = vi.fn().mockResolvedValue({ data: { role: "operator", is_active: true }, error: null });
    const client: AuthClient = {
      auth: { signInWithPassword, signOut: vi.fn() },
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) }) }),
    };

    await expect(signInWithEmployeeId(client, "025017", "password")).resolves.toBe(session);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "025017@smd.internal", password: "password" });
  });

  it("signs out and rejects an inactive or missing profile without exposing the internal identifier", async () => {
    const signOut = vi.fn();
    const client: AuthClient = {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: { session }, error: null }), signOut },
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }) }) }) }),
    };

    await expect(signInWithEmployeeId(client, "025017", "password")).rejects.toThrow("account_unavailable");
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("RequireRole", () => {
  it("keeps a loading guard from rendering protected content or redirecting", () => {
    render(guard({ status: "loading", session: null, profile: null }));
    expect(screen.getByText("Loading session…")).toBeInTheDocument();
    expect(screen.queryByText("admin page")).not.toBeInTheDocument();
  });

  it("redirects unauthenticated visitors to login while preserving a safe intended route", () => {
    render(guard({ status: "ready", session: null, profile: null }));
    expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fadmin%3Ftab%3Dusers");
  });

  it("redirects an inactive profile to login", () => {
    render(guard({ status: "ready", session, profile: { role: "admin", isActive: false } }));
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("redirects a signed-in user lacking the required role to the home route", () => {
    render(guard({ status: "ready", session, profile: { role: "viewer", isActive: true } }));
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("renders children for an active permitted role", () => {
    render(guard({ status: "ready", session, profile: { role: "admin", isActive: true } }));
    expect(screen.getByText("admin page")).toBeInTheDocument();
  });
});

describe("safe next navigation", () => {
  it("does not permit a protocol-relative or encoded redirect target", () => {
    expect(safeNextPath("%2F%2Fevil.example")).toBe("/");
  });
});

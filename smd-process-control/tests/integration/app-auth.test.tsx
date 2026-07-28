import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { AuthProvider, type SessionAuthClient } from "../../src/auth/AuthProvider";

const session = { user: { id: "user-1" } } as never;

function clientFor(profile: { role: "admin" | "operator" | "viewer"; is_active: boolean } | null): SessionAuthClient {
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
});

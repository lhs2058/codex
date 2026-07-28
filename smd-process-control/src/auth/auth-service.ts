import type { Session } from "@supabase/supabase-js";
import type { AppRole } from "../domain/types";
import { employeeIdToInternalEmail } from "./employee-id";

type AuthResult = { data: { session: Session | null }; error: { message: string } | null };
type ProfileResult = { data: { role: AppRole; is_active: boolean } | null; error: unknown | null };

export interface AuthClient {
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResult>;
    signOut(): Promise<unknown>;
  };
  from(table: "profiles"): {
    select(columns: string): { eq(column: string, value: string): { single(): PromiseLike<ProfileResult> } };
  };
}

export async function signInWithEmployeeId(
  client: AuthClient,
  employeeId: string,
  password: string,
): Promise<Session> {
  const { data, error } = await client.auth.signInWithPassword({
    email: employeeIdToInternalEmail(employeeId),
    password,
  });

  if (error || !data.session) {
    throw new Error("invalid_credentials");
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role,is_active")
    .eq("id", data.session.user.id)
    .single();

  if (profileError || !profile || !profile.is_active) {
    await client.auth.signOut();
    throw new Error("account_unavailable");
  }

  return data.session;
}

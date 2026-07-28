import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, readBoundedJson, rollbackCreatedUser } from "./helpers.ts";

const employeeIdPattern = /^\d{4,12}$/;
const validRoles = new Set(["operator", "admin", "viewer"]);

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function validRequest(value: unknown): value is { employeeId: string; displayName: string; role: "operator" | "admin" | "viewer"; temporaryPassword: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return typeof body.employeeId === "string" && employeeIdPattern.test(body.employeeId.trim())
    && typeof body.displayName === "string" && body.displayName.trim().length >= 1 && body.displayName.trim().length <= 100
    && typeof body.role === "string" && validRoles.has(body.role)
    && typeof body.temporaryPassword === "string" && body.temporaryPassword.length >= 12 && body.temporaryPassword.length <= 128;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
  const parsed = await readBoundedJson(request);
  if (!parsed.ok) return response(parsed.code === "payload_too_large" ? 413 : 400, { error: parsed.code });
  if (!validRequest(parsed.value)) return response(400, { error: "invalid_request" });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "unauthorized" });
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !serviceRoleKey) return response(500, { error: "service_unavailable" });

  const callerClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser(authorization.slice("Bearer ".length));
  if (userError || !userData.user) return response(401, { error: "unauthorized" });
  const { data: callerProfile, error: callerError } = await callerClient.from("profiles").select("role,is_active").eq("id", userData.user.id).single();
  if (callerError || !callerProfile || !callerProfile.is_active || callerProfile.role !== "admin") return response(403, { error: "forbidden" });

  const adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const employeeId = parsed.value.employeeId.trim();
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({ email: `${employeeId}@smd.internal`, password: parsed.value.temporaryPassword, email_confirm: true });
  if (createError || !created.user) return response(409, { error: "user_creation_failed" });
  const { error: profileError } = await adminClient.from("profiles").insert({ id: created.user.id, employee_id: employeeId, display_name: parsed.value.displayName.trim(), role: parsed.value.role, is_active: true, created_by: userData.user.id, updated_by: userData.user.id });
  if (profileError) {
    const cleanup = await rollbackCreatedUser(adminClient.auth.admin, created.user.id, crypto.randomUUID(), console.error);
    return response(cleanup === "deleted" ? 500 : 500, { error: cleanup === "deleted" ? "profile_creation_failed" : "cleanup_failed" });
  }
  return response(201, { id: created.user.id, employeeId, displayName: parsed.value.displayName.trim(), role: parsed.value.role });
});

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "unauthorized" });

  let body: unknown;
  try { body = await request.json(); } catch { return response(400, { error: "invalid_request" }); }
  if (!validRequest(body)) return response(400, { error: "invalid_request" });

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !serviceRoleKey) return response(500, { error: "service_unavailable" });

  const callerClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } });
  const token = authorization.slice("Bearer ".length);
  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) return response(401, { error: "unauthorized" });

  const { data: callerProfile, error: callerError } = await callerClient
    .from("profiles").select("role,is_active").eq("id", userData.user.id).single();
  if (callerError || !callerProfile || !callerProfile.is_active || callerProfile.role !== "admin") return response(403, { error: "forbidden" });

  const adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const employeeId = body.employeeId.trim();
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: `${employeeId}@smd.internal`, password: body.temporaryPassword, email_confirm: true,
  });
  if (createError || !created.user) return response(409, { error: "user_creation_failed" });

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: created.user.id, employee_id: employeeId, display_name: body.displayName.trim(), role: body.role,
    is_active: true, created_by: userData.user.id, updated_by: userData.user.id,
  });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return response(500, { error: "profile_creation_failed" });
  }
  return response(201, { id: created.user.id, employeeId, displayName: body.displayName.trim(), role: body.role });
});

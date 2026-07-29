export const MAX_BODY_BYTES = 12 * 1024;
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function buildProfileCreationRpcArgs(
  verifiedActorId: string,
  profileId: string,
  value: {
    employeeId: string;
    displayName: string;
    role: "operator" | "admin" | "viewer";
  },
) {
  return {
    p_profile_id: profileId,
    p_employee_id: value.employeeId.trim(),
    p_display_name: value.displayName.trim(),
    p_role: value.role,
    p_actor_id: verifiedActorId,
  };
}

export async function readBoundedJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; code: "invalid_request" | "payload_too_large" }> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return { ok: false, code: "invalid_request" };
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return { ok: false, code: "payload_too_large" };
  if (!request.body) return { ok: false, code: "invalid_request" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); return { ok: false, code: "payload_too_large" }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return { ok: false, code: "invalid_request" }; }
}

export interface AdminCleanupClient {
  deleteUser(userId: string): Promise<{ error: unknown | null }>;
  updateUserById(userId: string, attributes: { ban_duration: string }): Promise<{ error: unknown | null }>;
}

export async function rollbackCreatedUser(client: AdminCleanupClient, userId: string, correlationId: string, log: (record: Record<string, string>) => void): Promise<"deleted" | "cleanup_failed"> {
  const deletion = await client.deleteUser(userId);
  if (!deletion.error) return "deleted";
  const ban = await client.updateUserById(userId, { ban_duration: "876000h" });
  log({ event: "admin_create_user_cleanup_failed", userId, correlationId, banStatus: ban.error ? "failed" : "applied" });
  return "cleanup_failed";
}

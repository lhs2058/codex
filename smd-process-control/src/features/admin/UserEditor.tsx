import { useState } from "react";
import type { AppRole } from "../../domain/types";
import { normalizeEmployeeId } from "../../auth/employee-id";
import { useI18n, type TranslationKey } from "../../i18n";

export type NewUser = {
  employeeId: string;
  displayName: string;
  role: AppRole;
  temporaryPassword: string;
};

const legacy: Partial<Record<TranslationKey, string>> = {
  "admin.users": "Users",
  "admin.employeeId": "Employee ID",
  "admin.displayName": "Display name",
  "admin.role": "Role",
  "admin.viewer": "Viewer",
  "admin.operator": "Operator",
  "admin.admin": "Admin",
  "admin.temporaryPassword": "Temporary password",
  "admin.createUser": "Create user",
  "admin.userCreated": "User created.",
  "admin.userCreateError": "Unable to create user.",
};

export function UserEditor({
  createUser,
  disabled = false,
}: {
  createUser(input: NewUser): Promise<unknown>;
  disabled?: boolean;
}) {
  const { t } = useI18n(legacy);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  return <section aria-label={t("admin.users")}>
    <h2>{t("admin.users")}</h2>
    <form className="admin-form" onSubmit={async (event) => {
      event.preventDefault();
      setMessage("");
      try {
        const employeeId = normalizeEmployeeId(id);
        if (!name.trim() || password.length < 12) throw new Error("invalid-user");
        await createUser({ employeeId, displayName: name.trim(), role, temporaryPassword: password });
        setMessage(t("admin.userCreated"));
      } catch {
        setMessage(t("admin.userCreateError"));
      } finally {
        setPassword("");
      }
    }}>
      <label htmlFor="admin-employee-id">{t("admin.employeeId")}</label>
      <input id="admin-employee-id" disabled={disabled} value={id} onChange={(event) => setId(event.target.value)} />
      <label htmlFor="admin-display-name">{t("admin.displayName")}</label>
      <input id="admin-display-name" disabled={disabled} value={name} onChange={(event) => setName(event.target.value)} />
      <label htmlFor="admin-role">{t("admin.role")}</label>
      <select id="admin-role" disabled={disabled} value={role} onChange={(event) => setRole(event.target.value as AppRole)}>
        <option value="viewer">{t("admin.viewer")}</option>
        <option value="operator">{t("admin.operator")}</option>
        <option value="admin">{t("admin.admin")}</option>
      </select>
      <label htmlFor="admin-temporary-password">{t("admin.temporaryPassword")}</label>
      <input id="admin-temporary-password" disabled={disabled} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button disabled={disabled}>{t("admin.createUser")}</button>
    </form>
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>;
}

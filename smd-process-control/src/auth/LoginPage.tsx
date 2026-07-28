import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getSupabaseClient } from "../data/supabase";
import { signInWithEmployeeId, type AuthClient } from "./auth-service";
import { safeNextPath } from "./safe-next";
import { useI18n } from "../i18n";

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInWithEmployeeId(getSupabaseClient() as unknown as AuthClient, employeeId, password);
      navigate(safeNextPath(new URLSearchParams(location.search).get("next")), { replace: true });
    } catch {
      setError(t("login.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login-main"><h1>{t("login.title")}</h1><form onSubmit={onSubmit}>
    <label htmlFor="employee-id">{t("login.employeeId")}</label>
    <input id="employee-id" inputMode="numeric" autoComplete="username" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required />
    <label htmlFor="password">{t("login.password")}</label>
    <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
    {error && <p role="alert">{error}</p>}
    <button disabled={submitting} type="submit">{submitting ? t("login.submitting") : t("login.submit")}</button>
  </form></main>;
}

import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../data/supabase";
import { signInWithEmployeeId, type AuthClient } from "./auth-service";

function nextPath(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function LoginPage() {
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
      await signInWithEmployeeId(supabase as unknown as AuthClient, employeeId, password);
      navigate(nextPath(new URLSearchParams(location.search).get("next")), { replace: true });
    } catch {
      setError("사번 또는 비밀번호를 확인하세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main><h1>로그인</h1><form onSubmit={onSubmit}>
    <label htmlFor="employee-id">사번</label>
    <input id="employee-id" inputMode="numeric" autoComplete="username" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required />
    <label htmlFor="password">비밀번호</label>
    <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
    {error && <p role="alert">{error}</p>}
    <button disabled={submitting} type="submit">{submitting ? "로그인 중…" : "로그인"}</button>
  </form></main>;
}

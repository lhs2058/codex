const APPLICATION_ORIGIN = "https://smd-control.invalid";
const unsafeCharacter = /[\\\u0000-\u001f\u007f]/;

export function safeNextPath(value: string | null): string {
  if (!value) return "/";
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return "/"; }
  if (unsafeCharacter.test(value) || unsafeCharacter.test(decoded)) return "/";
  try {
    const url = new URL(decoded, APPLICATION_ORIGIN);
    if (url.origin !== APPLICATION_ORIGIN || !url.pathname.startsWith("/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

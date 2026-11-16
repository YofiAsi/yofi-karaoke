// Validates where to send a user after picking a name: same origin relative paths only.
export const DEFAULT_RETURN_PATH = "/";
export const RETURN_PATH_PARAM = "next";

const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_RETURN_PATH;
  if (UNSAFE_CHARACTERS.test(raw)) return DEFAULT_RETURN_PATH;
  if (raw === "/name" || raw.startsWith("/name?") || raw.startsWith("/name/")) return DEFAULT_RETURN_PATH;
  return raw;
}

export function returnPathFromSearch(search: string): string {
  return safeReturnPath(new URLSearchParams(search).get(RETURN_PATH_PARAM));
}

export function nameUrlFor(path: string): string {
  const safe = safeReturnPath(path);
  return safe === DEFAULT_RETURN_PATH ? "/name" : `/name?${RETURN_PATH_PARAM}=${encodeURIComponent(safe)}`;
}

export type CorsOrigin = string[] | boolean;

export const ANY_ORIGIN = "*";

export function parseOriginList(raw: string): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function resolveCorsOrigin(origins: string[]): CorsOrigin {
  if (origins.includes(ANY_ORIGIN)) return true;
  if (origins.length === 0) return false;
  return origins;
}

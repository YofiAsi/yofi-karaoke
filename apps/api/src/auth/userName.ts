export function nameMatches(name: string) {
  return { name: { equals: name.trim(), mode: "insensitive" as const } };
}

export const OLDEST_FIRST = { createdAt: "asc" as const };

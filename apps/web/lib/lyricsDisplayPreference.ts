// Remembers the chosen lyrics display per device and page in localStorage; every access tolerates a missing or failing storage.

export type DisplaySurface = "home" | "tv";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function preferenceKey(surface: DisplaySurface): string {
  return `karaoke.lyricsDisplay.${surface}`;
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDisplayPreference(
  storage: ReadableStorage | null,
  surface: DisplaySurface,
  validIds: readonly string[],
  fallback: string,
): string {
  try {
    const stored = storage?.getItem(preferenceKey(surface));
    return stored && validIds.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function saveDisplayPreference(storage: WritableStorage | null, surface: DisplaySurface, id: string): void {
  try {
    storage?.setItem(preferenceKey(surface), id);
  } catch {
    return;
  }
}

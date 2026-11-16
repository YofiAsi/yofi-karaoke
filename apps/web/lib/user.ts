import type { User } from "@karaoke/shared";
import { api, ApiError } from "./api";

const USER_KEY = "karaoke_user";

export function loadStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function storeUser(user: User): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USER_KEY);
}

export async function createUser(name: string, pin?: string): Promise<User> {
  const user = await api.post<User>("/api/users", pin ? { name, pin } : { name });
  storeUser(user);
  return user;
}

function isUnauthenticated(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export async function validateStoredUser(): Promise<User | null> {
  const stored = loadStoredUser();
  if (!stored) return null;
  try {
    const current = await api.get<User>("/api/users/me");
    storeUser(current);
    return current;
  } catch (err) {
    if (!isUnauthenticated(err)) return stored;
    clearStoredUser();
    return null;
  }
}

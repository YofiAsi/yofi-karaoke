import type { User } from "@karaoke/shared";
import { api } from "./api";

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

export async function createUser(name: string): Promise<User> {
  const user = await api.post<User>("/api/users", { name });
  storeUser(user);
  return user;
}

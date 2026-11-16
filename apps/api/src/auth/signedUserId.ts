import { fastifyCookie } from "@fastify/cookie";

export function signUserId(userId: string, secret: string): string {
  return fastifyCookie.sign(userId, secret);
}

export function unsignUserId(signedValue: string | undefined, secret: string): string | null {
  if (!signedValue) return null;
  const result = fastifyCookie.unsign(signedValue, secret);
  return result.valid ? result.value : null;
}

export function readUserIdFromCookieHeader(
  cookieHeader: string | undefined,
  cookieName: string,
  secret: string,
): string | null {
  const cookies = fastifyCookie.parse(cookieHeader ?? "");
  return unsignUserId(cookies[cookieName], secret);
}

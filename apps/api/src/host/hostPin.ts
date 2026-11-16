import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { clientKeyFromIp, createAttemptLimiter, type AttemptLimiter } from "./attemptLimiter.js";

export const HOST_PIN_LIMITS = {
  maxFailuresPerKey: 5,
  maxFailuresGlobal: 20,
  windowMs: 15 * 60 * 1000,
  maxKeys: 1000,
};

export interface PinRejection {
  status: 403 | 429;
  error: "pin_required" | "invalid_pin" | "too_many_attempts";
}

export const hostPinLimiter = createAttemptLimiter(HOST_PIN_LIMITS);

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function pinsMatch(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

export function authorizeHostPin(
  clientIp: string,
  pin: string | undefined,
  limiter: AttemptLimiter = hostPinLimiter,
): PinRejection | null {
  const clientKey = clientKeyFromIp(clientIp);
  if (limiter.isBlocked(clientKey)) return { status: 429, error: "too_many_attempts" };
  if (!pin) return { status: 403, error: "pin_required" };
  if (!pinsMatch(pin, env.HOST_PIN)) {
    limiter.recordFailure(clientKey);
    return { status: 403, error: "invalid_pin" };
  }
  limiter.reset(clientKey);
  return null;
}

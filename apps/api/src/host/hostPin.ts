import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { createAttemptLimiter, type AttemptLimiter } from "./attemptLimiter.js";

const MAX_PIN_FAILURES = 5;
const PIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

export interface PinRejection {
  status: 403 | 429;
  error: "pin_required" | "invalid_pin" | "too_many_attempts";
}

export const hostPinLimiter = createAttemptLimiter(MAX_PIN_FAILURES, PIN_FAILURE_WINDOW_MS);

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function pinsMatch(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

export function authorizeHostPin(
  clientKey: string,
  pin: string | undefined,
  limiter: AttemptLimiter = hostPinLimiter,
): PinRejection | null {
  if (limiter.isBlocked(clientKey)) return { status: 429, error: "too_many_attempts" };
  if (!pin) return { status: 403, error: "pin_required" };
  if (!pinsMatch(pin, env.HOST_PIN)) {
    limiter.recordFailure(clientKey);
    return { status: 403, error: "invalid_pin" };
  }
  limiter.reset(clientKey);
  return null;
}

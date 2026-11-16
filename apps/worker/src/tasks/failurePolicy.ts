export type FailureDecision = "retry" | "final" | "unavailable";

export interface AttemptInfo {
  attempts: number;
  maxAttempts: number;
}

const TRANSIENT_HINTS = [
  "try again later",
  "rate limit",
  "rate-limit",
  "too many requests",
  "http error 429",
  "not a bot",
  "temporarily",
];

function isTransientMessage(lower: string): boolean {
  return TRANSIENT_HINTS.some((hint) => lower.includes(hint));
}

export function isVideoUnavailableMessage(message: string): boolean {
  const s = message.toLowerCase();
  if (isTransientMessage(s)) return false;
  if (s.includes("video unavailable")) return true;
  if (s.includes("private video")) return true;
  if (s.includes("members only") || s.includes("members-only")) return true;
  if (s.includes("this video is not available")) return true;
  return false;
}

export function isFinalAttempt({ attempts, maxAttempts }: AttemptInfo): boolean {
  return attempts >= maxAttempts;
}

export function decideFailure(message: string, attempt: AttemptInfo): FailureDecision {
  if (isVideoUnavailableMessage(message)) return "unavailable";
  return isFinalAttempt(attempt) ? "final" : "retry";
}

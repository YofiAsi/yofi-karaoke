export type FailureDecision = "retry" | "final" | "unavailable";

export interface AttemptInfo {
  attempts: number;
  maxAttempts: number;
}

export function isVideoUnavailableMessage(message: string): boolean {
  const s = message.toLowerCase();
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

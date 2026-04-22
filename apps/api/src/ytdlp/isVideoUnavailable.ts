export function isYtVideoUnavailableMessage(message: string): boolean {
  const s = message.toLowerCase();
  if (s.includes("video unavailable")) return true;
  if (s.includes("private video")) return true;
  if (s.includes("members only") || s.includes("members-only")) return true;
  if (s.includes("this video is not available")) return true;
  return false;
}

// Picks the upcoming queue items worth announcing on the big screen and describes the join address.
import type { QueueItem } from "@karaoke/shared";

export function upNext(upcoming: QueueItem[], count: number): QueueItem[] {
  return upcoming.filter((item) => item.state !== "failed").slice(0, count);
}

export function displayOrigin(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host);
}

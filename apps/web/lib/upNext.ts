// Picks the upcoming queue items worth announcing on the big screen.
import type { QueueItem } from "@karaoke/shared";

export function upNext(upcoming: QueueItem[], count: number): QueueItem[] {
  return upcoming.filter((item) => item.state !== "failed").slice(0, count);
}

export function displayOrigin(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

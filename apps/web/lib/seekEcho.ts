// Tells a real seek apart from a playback state that only echoes the player's own position report.
export const SEEK_TOLERANCE_SECONDS = 1.5;
const REMEMBERED_REPORTS = 5;
const SAME_POSITION_EPSILON = 1e-6;

export function rememberReport(reports: readonly number[], positionSeconds: number): number[] {
  return [...reports, positionSeconds].slice(-REMEMBERED_REPORTS);
}

function echoesReport(positionSeconds: number, reports: readonly number[]): boolean {
  return reports.some((r) => Math.abs(r - positionSeconds) < SAME_POSITION_EPSILON);
}

export function shouldSeekPlayer(
  currentTime: number,
  statePositionSeconds: number,
  recentReports: readonly number[],
): boolean {
  if (echoesReport(statePositionSeconds, recentReports)) return false;
  return Math.abs(currentTime - statePositionSeconds) > SEEK_TOLERANCE_SECONDS;
}

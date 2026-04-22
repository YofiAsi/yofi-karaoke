/**
 * LRC file format parser
 * Parses LRC lyrics format with timestamps
 *
 * Format: [mm:ss.xx]Lyric text
 * - mm: minutes (00-99)
 * - ss: seconds (00-59)
 * - xx: hundredths of a second (00-99)
 *
 * May also contain word-level timestamps in the format:
 * [00:12.34]<00:12.34>Word1 <00:12.78>Word2
 */

export interface LrcLine {
  time: number; // time in seconds from start (e.g., 72.34)
  text: string; // lyric text, stripped of <word-level> tags
}

/**
 * Parse LRC format string into structured lyric lines
 *
 * @param lrc - LRC format string (or null/undefined for empty content)
 * @returns Array of parsed LRC lines sorted by time ascending
 *
 * Rules:
 * - Lines matching [mm:ss.xx] pattern are lyric lines
 * - Lines not matching pattern (metadata, empty) are skipped
 * - Time is converted to seconds: mm * 60 + ss + xx/100
 * - Word-level tags <...> are stripped from text
 * - Results are sorted by time ascending
 */
export function parseLrc(lrc: string | null | undefined): LrcLine[] {
  if (!lrc) {
    return [];
  }

  const lines: LrcLine[] = [];

  // Pattern to match [mm:ss.xx] at the start of a line
  // Captures: mm (minutes), ss (seconds), xx (hundredths)
  const timestampPattern = /^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/;

  const lrcLines = lrc.split('\n');

  for (const line of lrcLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue; // Skip empty lines
    }

    const match = trimmed.match(timestampPattern);
    if (!match) {
      continue; // Skip lines without timestamp pattern (e.g., metadata)
    }

    const mm = parseInt(match[1], 10);
    const ss = parseInt(match[2], 10);
    const xx = parseInt(match[3], 10);
    let text = match[4];

    // Convert to seconds
    const time = mm * 60 + ss + xx / 100;

    // Strip word-level timestamp tags <mm:ss.xx>
    text = text.replace(/<[\d:\.]+>/g, '');

    lines.push({ time, text });
  }

  // Sort by time ascending
  lines.sort((a, b) => a.time - b.time);

  return lines;
}

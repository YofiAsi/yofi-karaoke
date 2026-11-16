// Builds ordered LRCLIB search candidates from raw YouTube metadata.

export interface LyricsQueryInput {
  title: string;
  artist: string;
  track?: string | null;
  trackArtist?: string | null;
}

export type CandidateKind = "metadata" | "split" | "title" | "swapped";

export interface LyricsCandidate {
  track: string;
  artist: string;
  kind: CandidateKind;
}

const NOISE_WORD =
  /(?<![a-z])(official|video|audio|lyrics?|hd|4k|prod|remaster\w*|clip|visuali[sz]er)(?![a-z])|קליפ|רשמי|מילים/i;
const TRAILING_NOISE_WORD =
  /(?:^|\s+)(?:official|music|video|audio|lyrics?|hd|4k|clip|visuali[sz]er|remaster\w*|ה?קליפ|ה?רשמי|ה?מילים)$/i;
const BRACKET_GROUP = /\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}|【[^【】]*】/g;
const FEAT_TAIL = /(?:^|\s)[(\[]?(?:feat|ft|featuring)\.?\s.*$/i;
const TITLE_SEPARATOR = /\s+[-–—]\s+/;
const QUOTES = /["“”„«»]/g;
const HEBREW_LETTER = /[א-ת]/;
const EDGE_SINGLE_QUOTES = /^['‘’]+|['‘’]+$/g;
const EDGE_DASHES = /^[\s\-–—]+|[\s\-–—]+$/g;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}‍️]/gu;
const CHANNEL_SUFFIXES = [
  /\s*-\s*topic$/i,
  /\s*-?\s*הערוץ הרשמי$/,
  /\s+official(\s+channel)?$/i,
  /\s*-\s*$/,
];
const VEVO_SUFFIX = /vevo$/i;

export function buildLyricsCandidates(input: LyricsQueryInput): LyricsCandidate[] {
  const parts = meaningfulPipeParts(input.title);
  const splits = parts.map(splitCandidate).filter(isCandidate);
  const candidates = [
    metadataCandidate(input),
    ...splits,
    titleCandidate(parts[0] ?? "", input.artist),
    ...splits.map(swapCandidate),
  ];
  return dedupe(candidates.filter(isUsable));
}

export function cleanTitle(title: string): string {
  return cleanSegment(meaningfulPipeParts(title)[0] ?? "");
}

export function cleanChannel(channel: string): string {
  let result = stripEmoji(channel).trim();
  for (const suffix of CHANNEL_SUFFIXES) result = result.replace(suffix, "").trim();
  if (VEVO_SUFFIX.test(result)) result = splitCamelCase(result.replace(VEVO_SUFFIX, ""));
  return collapseSpaces(result);
}

function metadataCandidate(input: LyricsQueryInput): LyricsCandidate | null {
  if (!input.track?.trim()) return null;
  const artist = input.trackArtist?.trim() ? cleanPart(input.trackArtist) : cleanChannel(input.artist);
  return { track: cleanSegment(input.track), artist, kind: "metadata" };
}

function splitCandidate(part: string): LyricsCandidate | null {
  const segments = part.split(TITLE_SEPARATOR).map(cleanSegment).filter(Boolean);
  if (segments.length < 2) return null;
  const [artist, ...rest] = segments;
  return { track: rest.join(" - "), artist, kind: "split" };
}

function titleCandidate(part: string, channel: string): LyricsCandidate {
  return { track: cleanSegment(part), artist: cleanChannel(channel), kind: "title" };
}

function swapCandidate(candidate: LyricsCandidate): LyricsCandidate {
  return { track: candidate.artist, artist: candidate.track, kind: "swapped" };
}

function meaningfulPipeParts(title: string): string[] {
  return title
    .split("|")
    .map(stripNoiseBrackets)
    .filter((part) => cleanSegment(part).length > 0);
}

function cleanSegment(text: string): string {
  return stripTrailingNoise(cleanPart(stripNoiseBrackets(text)));
}

function cleanPart(text: string): string {
  const withoutFeat = stripEmoji(text).replace(FEAT_TAIL, "");
  const withoutQuotes = stripQuotes(withoutFeat).trim().replace(EDGE_SINGLE_QUOTES, "");
  return collapseSpaces(withoutQuotes.replace(EDGE_DASHES, ""));
}

function stripTrailingNoise(text: string): string {
  let result = text;
  while (TRAILING_NOISE_WORD.test(result)) result = result.replace(TRAILING_NOISE_WORD, "");
  return result.replace(EDGE_DASHES, "");
}

function stripQuotes(text: string): string {
  return text.replace(QUOTES, (quote, index: number) =>
    quote === '"' && isGershayim(text, index) ? quote : "",
  );
}

function isGershayim(text: string, index: number): boolean {
  return HEBREW_LETTER.test(text[index - 1] ?? "") && HEBREW_LETTER.test(text[index + 1] ?? "");
}

function stripNoiseBrackets(text: string): string {
  return text.replace(BRACKET_GROUP, (group) => (NOISE_WORD.test(group) ? " " : group));
}

function stripEmoji(text: string): string {
  return text.replace(EMOJI, "");
}

function splitCamelCase(text: string): string {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isCandidate(candidate: LyricsCandidate | null): candidate is LyricsCandidate {
  return candidate !== null;
}

function isUsable(candidate: LyricsCandidate | null): candidate is LyricsCandidate {
  return !!candidate && candidate.track.length > 0 && candidate.artist.length > 0;
}

function dedupe(candidates: LyricsCandidate[]): LyricsCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.artist.toLowerCase()}\u0000${c.track.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

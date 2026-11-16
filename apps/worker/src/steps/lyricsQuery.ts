// Builds ordered LRCLIB search candidates from raw YouTube metadata.

export interface LyricsQueryInput {
  title: string;
  artist: string;
  track?: string | null;
  trackArtist?: string | null;
}

export interface LyricsCandidate {
  track: string;
  artist: string;
}

const NOISE_WORD =
  /(?<![a-z])(official|video|audio|lyrics?|hd|4k|prod|remaster\w*|clip|visuali[sz]er)(?![a-z])|קליפ|רשמי|מילים/i;
const BRACKET_GROUP = /\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}|【[^【】]*】/g;
const FEAT_TAIL = /(?:^|\s)[(\[]?(?:feat|ft|featuring)\.?\s.*$/i;
const TITLE_SEPARATOR = /\s+[-–—]\s+/;
const QUOTES = /["“”„«»]/g;
const EDGE_SINGLE_QUOTES = /^['‘’]+|['‘’]+$/g;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}‍️]/gu;
const CHANNEL_SUFFIXES = [
  /\s*-\s*topic$/i,
  /\s*-?\s*הערוץ הרשמי$/,
  /\s+official(\s+channel)?$/i,
  /\s*-\s*$/,
];
const VEVO_SUFFIX = /vevo$/i;

export function buildLyricsCandidates(input: LyricsQueryInput): LyricsCandidate[] {
  const channelArtist = cleanChannel(input.artist);
  const candidates = [
    metadataCandidate(input, channelArtist),
    splitTitleCandidate(input.title),
    { track: cleanTitle(input.title), artist: channelArtist },
  ];
  return dedupe(candidates.filter(isUsable));
}

export function cleanTitle(title: string): string {
  return cleanPart(stripNoiseBrackets(cutAtPipe(title)));
}

export function cleanChannel(channel: string): string {
  let result = stripEmoji(channel).trim();
  for (const suffix of CHANNEL_SUFFIXES) result = result.replace(suffix, "").trim();
  if (VEVO_SUFFIX.test(result)) result = splitCamelCase(result.replace(VEVO_SUFFIX, ""));
  return collapseSpaces(result);
}

function metadataCandidate(
  input: LyricsQueryInput,
  channelArtist: string,
): LyricsCandidate | null {
  if (!input.track?.trim()) return null;
  const artist = input.trackArtist?.trim() ? cleanPart(input.trackArtist) : channelArtist;
  return { track: cleanPart(stripNoiseBrackets(input.track)), artist };
}

function splitTitleCandidate(title: string): LyricsCandidate | null {
  const parts = stripNoiseBrackets(cutAtPipe(title)).split(TITLE_SEPARATOR);
  if (parts.length < 2) return null;
  const [artist, ...rest] = parts;
  return { track: cleanPart(rest.join(" - ")), artist: cleanPart(artist) };
}

function cleanPart(text: string): string {
  const withoutFeat = stripEmoji(text).replace(FEAT_TAIL, "");
  const withoutQuotes = withoutFeat.replace(QUOTES, "").trim().replace(EDGE_SINGLE_QUOTES, "");
  return collapseSpaces(withoutQuotes.replace(/^[\s\-–—]+|[\s\-–—]+$/g, ""));
}

function cutAtPipe(text: string): string {
  return text.split("|")[0];
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

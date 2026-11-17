/* Reads YouTube video ids out of a text list of links, bare ids or database export rows. */
const LINK_ID = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;
const BARE_ID = /^[A-Za-z0-9_-]{11}$/;
const FIELD_SEPARATOR = /[\s|,;]+/;

function videoIdOf(line: string): string | null {
  const fromLink = LINK_ID.exec(line)?.[1];
  if (fromLink) return fromLink;
  const firstField = line.trim().split(FIELD_SEPARATOR)[0] ?? "";
  return BARE_ID.test(firstField) ? firstField : null;
}

export function parseVideoIds(text: string): string[] {
  const ids = text.split(/\r?\n/).map(videoIdOf).filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

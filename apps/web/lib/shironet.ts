// Builds a Shironet search link from a Hebrew video title, so lyrics can be copied by hand and pasted.
const SEARCH_URL = "https://shironet.mako.co.il/search";
const HEBREW_LETTER = /[א-ת]/;
const BRACKETED = /[([{][^)\]}]*[)\]}]/g;
const EDGE_NOISE = /^[^א-ת0-9]+|[^א-ת0-9]+$/g;
const DIGITS_ONLY = /^\d+$/;

function isSearchWord(word: string): boolean {
  return HEBREW_LETTER.test(word) || DIGITS_ONLY.test(word);
}

export function shironetQuery(title: string): string {
  return title
    .split("|")[0]
    .replace(BRACKETED, " ")
    .split(/\s+/)
    .map((word) => word.replace(EDGE_NOISE, ""))
    .filter(isSearchWord)
    .join(" ");
}

export function shironetSearchUrl(title: string): string | null {
  const query = shironetQuery(title);
  if (!HEBREW_LETTER.test(query)) return null;
  return `${SEARCH_URL}?q=${encodeURIComponent(query)}`;
}

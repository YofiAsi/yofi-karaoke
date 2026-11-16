#!/usr/bin/env python3
"""Converts Japanese lyric lines to lower case Hepburn romaji with pykakasi plus small deterministic fixes.

Reads {"lines": [...]} on stdin and writes {"lines": [...], "failed": n, "unavailable": null | reason} on stdout.
Lines come back unchanged when the song has no kana, when a line has no Japanese characters, or when its conversion raises.
"""

import json
import re
import sys
from dataclasses import dataclass

KANA = re.compile(r"[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]")
KANJI = re.compile(r"[\u3005\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
KATAKANA = re.compile(r"[\u30a1-\u30fa\u30fc-\u30ff\uff66-\uff9f]")
KANA_OR_KANJI = re.compile(r"[\u3005\u3041-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]")
HIRAGANA_ONLY = re.compile(r"^[\u3041-\u309f]+$")
NEEDS_CONVERSION = re.compile(KANA_OR_KANJI.pattern + r"|[\u3000-\u303f\u30fb\uff01-\uff5e]")
VOWEL = re.compile(r"[aeiou]")

SMALL_TSU = "\u3063"
ITERATION_MARK = "\u3005"
MIDDLE_DOT = "\u30fb"
LONG_VOWEL = "\u30fc"
WO = "\u3092"
PARTICLES = {"\u306f": "wa", "\u3078": "e", WO: "o"}
GREETINGS = {"\u3053\u3093\u306b\u3061\u306f": "konnichiwa", "\u3053\u3093\u3070\u3093\u306f": "konbanwa"}
LAUGHTER = set("\u306f\u30cf\u3078\u30d8\u3042\u30a2\u3063\u30c3")
NO_GLUE_AFTER = set("\u306b\u306e\u3067\u3068\u304c\u3082\u3078\u3092\u306f\u3084")
MIN_KANA_SHARE = 0.2
DIGIT_OR_NUMERAL = re.compile(r"[0-9\uff10-\uff19\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4f55\u6570\u5e7e]")
ENHANCED_TAG = re.compile(r"(<\d+:\d+(?:[.:]\d+)?>)")
PARTICLE_REMAINDERS = {"\u3082", "\u306e", "\u3068"}
PARTICLE_REMAINDER_STARTS = (
    "\u3042\u306e", "\u305d\u306e", "\u3053\u306e", "\u3069\u306e", "\u3057\u306a",
    "\u307e\u3060", "\u3082\u3046", "\u3044\u3064\u3082", "\u3044\u3064\u304b", "\u304d\u3063\u3068", "\u305a\u3063\u3068", "\u3082\u3063\u3068", "\u305f\u3060", "\u306a\u305c", "\u3069\u3053", "\u3069\u3046", "\u3059\u3050", "\u307e\u305f", "\u3044\u307e", "\u306a\u3044", "\u306a\u304f", "\u3044\u306a", "\u3044\u304f", "\u3044\u3053", "\u3044\u3051", "\u3086\u304f", "\u3086\u3053", "\u304b\u3048",
)
NO_GLUE_BEFORE = set("\u306e\u304c\u306b\u3068\u3082")
READING_OVERRIDES = {
    "\u541b": "\u304d\u307f",
    "\u4eba": "\u3072\u3068",
    "\u65e5": "\u3072",
    "\u611b\u3057": "\u3042\u3044\u3057",
    "\u4eca\u65e5\u306f": "\u304d\u3087\u3046\u306f",
}
LOANWORD_SOUNDS = {
    "\u3066\u3043": "ti", "\u3067\u3043": "di", "\u3068\u3045": "tu", "\u3069\u3045": "du",
    "\u3046\u3043": "wi", "\u3046\u3047": "we", "\u3046\u3049": "wo",
    "\u3058\u3047": "je", "\u3057\u3047": "she", "\u3061\u3047": "che",
    "\u3075\u3041": "fa", "\u3075\u3043": "fi", "\u3075\u3047": "fe", "\u3075\u3049": "fo",
    "\u3094\u3041": "va", "\u3094\u3043": "vi", "\u3094\u3047": "ve", "\u3094\u3049": "vo",
}
LOANWORD_SPLIT = re.compile("(" + "|".join(LOANWORD_SOUNDS) + ")")
OPENING = {
    "\u300c": '"', "\u300e": '"', "\uff08": "(", "\u3010": "[", "\u3008": '"', "\u300a": '"', "(": "(", "[": "[",
}
CLOSING = {
    "\u300d": '"', "\u300f": '"', "\uff09": ")", "\u3011": "]", "\u3009": '"', "\u300b": '"', ")": ")", "]": "]",
    "\u3001": ",", "\u3002": ".", "\uff0c": ",", "\uff0e": ".", "\uff01": "!", "\uff1f": "?", "\uff1a": ":",
    "\uff1b": ";", ",": ",", ".": ".", "!": "!", "?": "?", "\u2026": "\u2026", "\u2025": "\u2026",
    "\u301c": "~", "\uff5e": "~",
}
SPACES = {"\u3000", MIDDLE_DOT, " ", "\t"}


@dataclass
class Piece:
    text: str
    kind: str
    glue: bool = False


def is_japanese(text: str) -> bool:
    return bool(KANA_OR_KANJI.search(text))


def has_kanji_or_katakana(orig: str) -> bool:
    return bool(KANJI.search(orig) or KATAKANA.search(orig))


def is_laughter(orig: str) -> bool:
    return bool(orig) and set(orig) <= LAUGHTER


def next_to_number(segments: list, index: int) -> bool:
    before = segments[index - 1][0][-1:] if index else ""
    after = segments[index + 1][0][:1] if index + 1 < len(segments) else ""
    return bool(DIGIT_OR_NUMERAL.match(before) or DIGIT_OR_NUMERAL.match(after))


def overridden(segments: list, index: int) -> tuple:
    orig, hira = segments[index]
    if orig not in READING_OVERRIDES or (len(orig) == 1 and next_to_number(segments, index)):
        return orig, hira
    return orig, READING_OVERRIDES[orig]


def apply_overrides(segments: list) -> list:
    return [overridden(segments, index) for index in range(len(segments))]


def is_particle_remainder(rest: str) -> bool:
    return rest in PARTICLE_REMAINDERS or rest.startswith(PARTICLE_REMAINDER_STARTS)


def split_inner_wo(orig: str, hira: str) -> list:
    if not HIRAGANA_ONLY.match(orig) or WO not in orig[1:-1]:
        return [(orig, hira)]
    parts = []
    for index, chunk in enumerate(orig.split(WO)):
        if index:
            parts.append((WO, WO))
        if chunk:
            parts.append((chunk, chunk))
    return parts


def split_trailing_particle(orig: str, hira: str) -> list:
    head = orig[:-1]
    if len(orig) < 2 or orig[-1] not in PARTICLES or not hira.endswith(orig[-1]):
        return [(orig, hira)]
    if hira in GREETINGS or is_laughter(head):
        return [(orig, hira)]
    return [(head, hira[:-1]), (orig[-1], orig[-1])]


def split_leading_particle(orig: str, hira: str, previous: str) -> list:
    if len(orig) < 2 or orig[0] not in PARTICLES or not HIRAGANA_ONLY.match(orig) or is_laughter(orig):
        return [(orig, hira)]
    if not has_kanji_or_katakana(previous) or not (orig[0] == WO or is_particle_remainder(orig[1:])):
        return [(orig, hira)]
    return [(orig[0], orig[0]), (orig[1:], hira[1:])]


def split_particles(segments: list) -> list:
    result = []
    for orig, hira in segments:
        previous = result[-1][0] if result else ""
        for lead in split_leading_particle(orig, hira, previous):
            for inner in split_inner_wo(*lead):
                result.extend(split_trailing_particle(*inner))
    return result


def kana_romaji(kakasi, kana: str) -> str:
    return "".join(item["hepburn"] for item in kakasi.convert(kana))


def extend_long_vowel(romaji: str, chunk: str, kakasi) -> str:
    vowels = VOWEL.findall(romaji)
    stretched = vowels[-1] if vowels else ""
    return stretched + kana_romaji(kakasi, chunk[1:]) if chunk[1:] else stretched


def reading_romaji(kakasi, hira: str) -> str:
    romaji = ""
    for chunk in LOANWORD_SPLIT.split(hira):
        if chunk in LOANWORD_SOUNDS:
            romaji += LOANWORD_SOUNDS[chunk]
        elif chunk.startswith(LONG_VOWEL):
            romaji += extend_long_vowel(romaji, chunk, kakasi)
        elif chunk:
            romaji += kana_romaji(kakasi, chunk)
    return romaji.replace(MIDDLE_DOT, " ")


def word_romaji(kakasi, orig: str, hira: str) -> str:
    if orig in PARTICLES:
        return PARTICLES[orig]
    if hira in GREETINGS:
        return GREETINGS[hira]
    if not hira:
        return orig
    return reading_romaji(kakasi, hira).lower()


def is_symbol(orig: str) -> bool:
    return all(char in OPENING or char in CLOSING or char in SPACES for char in orig)


def symbol_text(orig: str) -> str:
    return "".join(OPENING.get(char, CLOSING.get(char, " ")) for char in orig)


def symbol_piece(orig: str) -> Piece:
    if all(char in SPACES for char in orig):
        return Piece(" ", "space")
    return Piece(symbol_text(orig), "open" if orig[0] in OPENING else "close")


def other_piece(kakasi, orig: str) -> Piece:
    if is_symbol(orig):
        return symbol_piece(orig)
    return Piece(orig if orig.isascii() else kana_romaji(kakasi, orig), "latin")


def ends_in_small_tsu(hira: str) -> bool:
    return hira.endswith(SMALL_TSU)


def continues_word(segments: list, index: int) -> bool:
    orig = segments[index][0]
    if index + 1 >= len(segments) or not KANJI.search(orig) or not HIRAGANA_ONLY.match(orig[-1]):
        return False
    following = segments[index + 1][0]
    if not HIRAGANA_ONLY.match(following) or following in PARTICLES:
        return False
    return orig[-1] not in NO_GLUE_AFTER and following[0] not in NO_GLUE_BEFORE


def word_piece(kakasi, segments: list, index: int) -> Piece:
    orig, hira = segments[index]
    reading = hira[:-1] if ends_in_small_tsu(hira) else hira
    text = "" if ends_in_small_tsu(hira) and not reading else word_romaji(kakasi, orig, reading)
    return Piece(text, "word", ends_in_small_tsu(hira) or continues_word(segments, index))


def word_pieces(kakasi, segments: list) -> list:
    pieces = []
    for index, (orig, _hira) in enumerate(segments):
        if orig.startswith(SMALL_TSU) and pieces:
            pieces[-1].glue = True
        if orig == ITERATION_MARK and pieces:
            pieces.append(Piece(pieces[-1].text, "word"))
        else:
            pieces.append(word_piece(kakasi, segments, index))
    return pieces


def double_consonant(romaji: str) -> str:
    if romaji.startswith("ch"):
        return "t" + romaji
    if romaji[:1].isalpha() and not VOWEL.match(romaji[:1]) and romaji[:1] != "n":
        return romaji[0] + romaji
    return romaji


def geminate_following(pieces: list, segments: list) -> None:
    for index in range(len(pieces) - 1):
        if ends_in_small_tsu(segments[index][1]) and pieces[index + 1].kind == "word":
            pieces[index + 1].text = double_consonant(pieces[index + 1].text)


def flush_words(kakasi, words: list) -> list:
    if not words:
        return []
    segments = split_particles(words)
    pieces = word_pieces(kakasi, segments)
    geminate_following(pieces, segments)
    return pieces


def convert_segments(kakasi, segments: list) -> list:
    pieces, words = [], []
    for orig, hira in apply_overrides(segments):
        if is_japanese(orig):
            words.append((orig, hira))
            continue
        pieces.extend(flush_words(kakasi, words))
        words = []
        pieces.append(other_piece(kakasi, orig))
    pieces.extend(flush_words(kakasi, words))
    return pieces


def needs_space(previous: Piece, current: Piece) -> bool:
    if previous.glue and current.kind == "word":
        return False
    if current.kind in ("close", "space") or previous.kind in ("open", "space"):
        return False
    return not (previous.kind == "latin" and current.kind == "latin")


def join_pieces(pieces: list) -> str:
    text = ""
    for index, piece in enumerate(pieces):
        if index and needs_space(pieces[index - 1], piece):
            text += " "
        text += piece.text
    return re.sub(r"\s+", " ", text).strip()


def raw_segments(kakasi, text: str) -> list:
    return [(item["orig"], item["hira"]) for item in kakasi.convert(text)]


def is_lossless(segments: list, text: str) -> bool:
    return "".join(orig for orig, _hira in segments) == text


def is_unreadable(kakasi, char: str) -> bool:
    return bool(KANJI.match(char)) and not "".join(hira for _orig, hira in raw_segments(kakasi, char))


def segments_around(kakasi, line: str, unreadable: set) -> list:
    segments = []
    for chunk in re.split("([" + re.escape("".join(sorted(unreadable))) + "])", line):
        if chunk in unreadable:
            segments.append((chunk, ""))
        elif chunk:
            segments.extend(raw_segments(kakasi, chunk))
    return segments


def segment_line(kakasi, line: str) -> list:
    segments = raw_segments(kakasi, line)
    if is_lossless(segments, line):
        return segments
    unreadable = {char for char in set(line) if is_unreadable(kakasi, char)}
    segments = segments_around(kakasi, line, unreadable) if unreadable else segments
    if not is_lossless(segments, line):
        raise ValueError("pykakasi dropped characters from the line")
    return segments


def convert_text(kakasi, text: str) -> str:
    return join_pieces(convert_segments(kakasi, segment_line(kakasi, text)))


def keep_edge_spaces(original: str, converted: str) -> str:
    lead = " " if original[:1].isspace() else ""
    trail = " " if original[-1:].isspace() and converted else ""
    return lead + converted + trail


def convert_part(kakasi, part: str) -> str:
    if ENHANCED_TAG.fullmatch(part) or not NEEDS_CONVERSION.search(part):
        return part
    return keep_edge_spaces(part, convert_text(kakasi, part))


def convert_line(kakasi, line: str) -> str:
    parts = ENHANCED_TAG.split(line)
    if len(parts) == 1:
        return convert_text(kakasi, line) if NEEDS_CONVERSION.search(line) else line
    return "".join(convert_part(kakasi, part) for part in parts)


def load_kakasi():
    import pykakasi

    return pykakasi.kakasi()


def kana_share(text: str) -> float:
    kana, han = len(KANA.findall(text)), len(KANJI.findall(text))
    return kana / (kana + han) if kana + han else 0.0


def is_japanese_song(lines: list) -> bool:
    return kana_share("\n".join(lines)) >= MIN_KANA_SHARE


def unchanged(lines: list, unavailable=None) -> dict:
    return {"lines": list(lines), "failed": 0, "unavailable": unavailable}


def romanize_lines(lines: list, kakasi_factory=load_kakasi) -> dict:
    if not is_japanese_song(lines):
        return unchanged(lines)
    try:
        kakasi = kakasi_factory()
    except Exception as exc:
        return unchanged(lines, f"{type(exc).__name__}: {exc}")
    converted, failed = [], 0
    for line in lines:
        try:
            converted.append(convert_line(kakasi, line))
        except Exception:
            failed += 1
            converted.append(line)
    return {"lines": converted, "failed": failed, "unavailable": None}


def read_lines(stream) -> list:
    payload = json.loads(stream.read() or "{}")
    lines = payload.get("lines") if isinstance(payload, dict) else None
    if not isinstance(lines, list) or not all(isinstance(line, str) for line in lines):
        raise ValueError("input must be a JSON object with a lines array of strings")
    return lines


def main() -> None:
    sys.stdin.reconfigure(encoding="utf-8")
    result = romanize_lines(read_lines(sys.stdin))
    sys.stdout.write(json.dumps(result) + "\n")


if __name__ == "__main__":
    main()

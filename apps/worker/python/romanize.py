#!/usr/bin/env python3
"""Converts Japanese lyric lines to lower case Hepburn romaji with cutlet (MeCab with unidic-lite), falling back to pykakasi.

Reads {"lines": [...]} on stdin and writes {"lines": [...], "failed": n, "unavailable": null | reason, "fallback": null | reason} on stdout.
Lines come back unchanged when the song is not Japanese, when a line has no Japanese characters, or when its conversion raises.
"""

import json
import re
import sys

import kakasi_romaji

KANA = re.compile(r"[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]")
KANJI = kakasi_romaji.KANJI
JAPANESE = kakasi_romaji.KANA_OR_KANJI.pattern
NEEDS_CONVERSION = re.compile(JAPANESE + r"|[\u3000-\u303f\u30fb\uff01-\uff5e]")
NON_ASCII_RUN = re.compile(r"([0-9]*[^\x00-\x7f]+(?:[0-9]+[^\x00-\x7f]+)*[0-9]*)")
DIGIT_LETTER_EDGE = re.compile(r"(?<=[0-9])(?=[a-z])|(?<=[a-z])(?=[0-9])")
SMALL_TSU = ("\u3063", "\u30c3")
SMALL_TSU_ONLY = re.compile(r"[\u3063\u30c3]+")
SPACE_AFTER = set(",.!?;:)]~\u2026")
SYMBOL_ROMAJI = {"\u301c": "~"}
SYMBOL_POS = "\u88dc\u52a9\u8a18\u53f7"
NUMBER_POS = "\u6570\u8a5e"
COUNTER_AFTER_DIGITS = {"\u65e5": "nichi", "\u6708": "gatsu"}
ENHANCED_TAG = re.compile(r"(<\d+:\d+(?:[.:]\d+)?>)")
MIN_KANA_SHARE = 0.2
WORD_READINGS = {"\u3053\u3093\u306b\u3061\u306f": "konnichiwa", "\u3053\u3093\u3070\u3093\u306f": "konbanwa", "\u79c1": "watashi", "\u8a00\u3046": "iu"}
KANA_SOUNDS = {"\u3046\u3043": "wi", "\u3046\u3047": "we", "\u3046\u3049": "wo", "\u30fb": " "}
NANI = "\u4f55"
QUESTION_WORDS = {"\u3044\u3064", "\u3069\u3053", "\u3060\u308c", "\u8ab0", NANI, "\u306a\u306b"}
QUESTION_ENDINGS = {"\u304b", "\u3082"}
GLUED_PAIRS = {("\u3067", "\u3082"), ("\u3068", "\u304b"), ("\u3060", "\u3063\u3066")}
NAN_BEFORE = ("d", "t", "n")
ENGINES = ("cutlet", "pykakasi")


def load_cutlet():
    import cutlet

    katsu = cutlet.Cutlet(use_foreign_spelling=False, ensure_ascii=False)
    katsu.use_wo = False
    katsu.exceptions = dict(WORD_READINGS)
    for kana, romaji in KANA_SOUNDS.items():
        katsu.update_mapping(kana, romaji)
    return katsu


class Engines:
    def __init__(self, cutlet_factory=load_cutlet, kakasi_factory=kakasi_romaji.load):
        self.factories = {"cutlet": cutlet_factory, "pykakasi": kakasi_factory}
        self.loaded = {}
        self.errors = {}
        self.raised = {name: 0 for name in ENGINES}

    def get(self, name: str):
        if name not in self.loaded and name not in self.errors:
            try:
                self.loaded[name] = self.factories[name]()
            except Exception as exc:
                self.errors[name] = f"{type(exc).__name__}: {exc}"
        return self.loaded.get(name)

    def error(self, name: str):
        return f"{name} {self.errors[name]}" if name in self.errors else None

    def any_available(self) -> bool:
        return any(self.get(name) is not None for name in ENGINES)

    def fallback(self):
        if "cutlet" in self.errors:
            return self.error("cutlet")
        count = self.raised["cutlet"]
        return f"cutlet raised on lines: {count}" if count else None


def is_glued(word, following) -> bool:
    if word.surface == NANI and word.feature.pos2 == NUMBER_POS:
        return True
    if word.surface in QUESTION_WORDS and following.surface in QUESTION_ENDINGS:
        return True
    return (word.surface, following.surface) in GLUED_PAIRS


def nani_reading(word, following_romaji: str) -> bool:
    return word.surface == NANI and word.feature.pos2 != NUMBER_POS and not following_romaji.startswith(NAN_BEFORE)


def is_counter_after_digits(word, previous) -> bool:
    return previous is not None and previous.surface.isdigit() and word.surface in COUNTER_AFTER_DIGITS


def is_tsu_before_symbol(word, following, token) -> bool:
    return word.surface.endswith(SMALL_TSU) and following.feature.pos1 == SYMBOL_POS and not token.surface[-1:].isalpha()


def fix_word_pairs(words: list, tokens: list) -> None:
    for index, word in enumerate(words):
        previous = words[index - 1] if index else None
        following = words[index + 1] if index + 1 < len(words) else None
        if nani_reading(word, tokens[index + 1].surface if following else ""):
            tokens[index].surface = "nani"
        if is_counter_after_digits(word, previous):
            tokens[index].surface = COUNTER_AFTER_DIGITS[word.surface]
        if previous is not None and word.surface == kakasi_romaji.ITERATION_MARK and not tokens[index].surface:
            tokens[index].surface = tokens[index - 1].surface
            tokens[index - 1].space = False
        if following and is_tsu_before_symbol(word, following, tokens[index]):
            tokens[index].surface = tokens[index].surface[:-1]
        if following and is_glued(word, following):
            tokens[index].space = False


def kept_surface(surface: str) -> str:
    return "" if SMALL_TSU_ONLY.fullmatch(surface) else SYMBOL_ROMAJI.get(surface, surface)


def is_kept_symbol(word, token) -> bool:
    return not token.surface and not word.surface.isascii() and bool(kept_surface(word.surface))


def space_kept_symbols(words: list, tokens: list) -> None:
    for index, (word, token) in enumerate(zip(words, tokens)):
        if not is_kept_symbol(word, token):
            continue
        token.space = True
        if index:
            tokens[index - 1].space = kept_surface(word.surface) != "~"


def token_text(word, token) -> str:
    if not word.surface.isascii():
        token.surface = token.surface.lower() or kept_surface(word.surface)
    return str(token)


def cutlet_chunk(katsu, chunk: str) -> str:
    from cutlet.cutlet import normalize_text

    words = katsu.tagger(normalize_text(chunk))
    tokens = katsu.romaji_tokens(words, capitalize=False)
    fix_word_pairs(words, tokens)
    space_kept_symbols(words, tokens)
    text ="".join(token_text(word, token) for word, token in zip(words, tokens)).strip()
    return DIGIT_LETTER_EDGE.sub(" ", text)


def needs_space(text: str, chunk: str) -> bool:
    return chunk[:1].isalnum() and (text[-1:].isalnum() or text[-1:] in SPACE_AFTER)


def join_chunks(chunks: list) -> str:
    text = ""
    for chunk in chunks:
        if needs_space(text, chunk):
            text += " "
        text += chunk
    return re.sub(r"\s+", " ", text).strip()


def cutlet_text(katsu, text: str) -> str:
    chunks = [chunk for chunk in NON_ASCII_RUN.split(text) if chunk]
    return join_chunks([chunk if chunk.isascii() else cutlet_chunk(katsu, chunk) for chunk in chunks])


CONVERTERS = {"cutlet": cutlet_text, "pykakasi": kakasi_romaji.convert_text}


def converted_or_original(converted: str, text: str) -> str:
    return converted if converted or not text.strip() else text


def convert_text(engines: Engines, text: str) -> str:
    error = None
    for name in ENGINES:
        engine = engines.get(name)
        if engine is None:
            continue
        try:
            return converted_or_original(CONVERTERS[name](engine, text), text)
        except Exception as exc:
            engines.raised[name] += 1
            error = exc
    raise RuntimeError(f"no romanizer could convert the line: {error}")


def keep_edge_spaces(original: str, converted: str) -> str:
    lead = " " if original[:1].isspace() else ""
    trail = " " if original[-1:].isspace() and converted else ""
    return lead + converted + trail


def convert_part(engines: Engines, part: str) -> str:
    if ENHANCED_TAG.fullmatch(part) or not NEEDS_CONVERSION.search(part):
        return part
    return keep_edge_spaces(part, convert_text(engines, part))


def convert_line(engines: Engines, line: str) -> str:
    parts = ENHANCED_TAG.split(line)
    if len(parts) == 1:
        return convert_text(engines, line) if NEEDS_CONVERSION.search(line) else line
    return "".join(convert_part(engines, part) for part in parts)


def kana_share(text: str) -> float:
    kana, han = len(KANA.findall(text)), len(KANJI.findall(text))
    return kana / (kana + han) if kana + han else 0.0


def is_japanese_song(lines: list) -> bool:
    return kana_share("\n".join(lines)) >= MIN_KANA_SHARE


def unchanged(lines: list, unavailable=None) -> dict:
    return {"lines": list(lines), "failed": 0, "unavailable": unavailable, "fallback": None}


def unavailable_reason(engines: Engines) -> str:
    return "; ".join(engines.error(name) for name in ENGINES)


def romanize_lines(lines: list, engines=None) -> dict:
    if not is_japanese_song(lines):
        return unchanged(lines)
    engines = engines or Engines()
    if not engines.any_available():
        return unchanged(lines, unavailable_reason(engines))
    converted, failed = [], 0
    for line in lines:
        try:
            converted.append(convert_line(engines, line))
        except Exception:
            failed += 1
            converted.append(line)
    return {"lines": converted, "failed": failed, "unavailable": None, "fallback": engines.fallback()}


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

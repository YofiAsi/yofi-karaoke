"""Unit tests for the pykakasi fallback with invented lines. Run: python -m unittest discover -s apps/worker/python"""

import importlib.util
import unittest

import kakasi_romaji
from romanize import Engines, romanize_lines

HAS_PYKAKASI = importlib.util.find_spec("pykakasi") is not None


def no_cutlet():
    raise ImportError("cutlet switched off for this test")


def convert(*lines):
    return romanize_lines(list(lines), Engines(cutlet_factory=no_cutlet))["lines"]


@unittest.skipUnless(HAS_PYKAKASI, "pykakasi is not installed")
class FallbackConversionTest(unittest.TestCase):
    def test_kana_only_lines(self):
        self.assertEqual(convert("さよなら、またね！", "ラーメンとコーヒー"), ["sayonara, matane!", "raamen to koohii"])

    def test_kanji_lines(self):
        self.assertEqual(convert("心の中で叫んでる", "夢を見ていた"), ["kokoro no naka de sakenderu", "yume o miteita"])

    def test_particles_read_wa_e_o(self):
        self.assertEqual(convert("私は海へ行く"), ["watashi wa umi e iku"])
        self.assertEqual(convert("君を待っている"), ["kimi o matteiru"])
        self.assertEqual(convert("僕らはまだ知らない"), ["bokura wa mada shiranai"])
        self.assertEqual(convert("どこへ行くの", "きみをまってる"), ["doko e iku no", "kimi o matteru"])

    def test_ha_and_he_split_only_before_a_known_follower(self):
        self.assertEqual(convert("君はじめて", "手はなさない"), ["kimi hajimete", "te hanasanai"])
        self.assertEqual(convert("花はまだ", "空へいこう", "手は離さない"), ["hana wa mada", "sora e ikou", "te wa hanasanai"])
        self.assertEqual(convert("今はあの空", "続きはしない", "全てをかけて"), ["ima wa ano sora", "tsuzuki wa shinai", "subete o kakete"])

    def test_single_kanji_overrides_skip_number_neighbours(self):
        self.assertEqual(convert("1日", "あの日", "3人で", "あの人"), ["1 nichi", "ano hi", "3 nin de", "ano hito"])
        self.assertEqual(convert("あの日踏み出して"), ["ano hi fumi dashite"])

    def test_enhanced_lrc_word_tags_stay_intact(self):
        self.assertEqual(convert("<00:01.00>君を<00:02.00>待つ"), ["<00:01.00>kimi o<00:02.00>matsu"])

    def test_words_that_contain_ha_keep_it(self):
        self.assertEqual(convert("はじめての花火", "ははは"), ["hajimeteno hanabi", "hahaha"])
        self.assertEqual(convert("こんにちは"), ["konnichiwa"])

    def test_small_tsu_and_long_vowels(self):
        self.assertEqual(convert("ちょっと待って", "走って行こう"), ["chotto matte", "hashitte ikou"])
        self.assertEqual(convert("あっ、雨"), ["a, ame"])
        self.assertEqual(convert("東京タワー", "パーティー"), ["toukyou tawaa", "paatii"])

    def test_loanword_sounds(self):
        self.assertEqual(convert("ジェットコースター", "ラブ・ソング"), ["jettokoosutaa", "rabu songu"])

    def test_mixed_japanese_and_english(self):
        self.assertEqual(convert("Baby I love you 君だけを"), ["Baby I love you kimi dake o"])
        self.assertEqual(convert("Oh yeah 今夜は Dance"), ["Oh yeah konya wa Dance"])

    def test_full_width_text_and_brackets(self):
        self.assertEqual(convert("「さあ」行こう", "ＬＯＶＥ １２３ ね"), ['"saa" ikou', "LOVE 123 ne"])

    def test_unreadable_han_characters_are_kept_instead_of_dropped(self):
        self.assertEqual(convert("東京龘ね"), ["toukyou 龘 ne"])

    def test_romaji_comes_back_unchanged(self):
        first = convert("君を待っている", "さよなら、またね！")
        self.assertEqual(convert(*first), first)

    def test_the_result_names_why_cutlet_was_not_used(self):
        result = romanize_lines(["夢をみた"], Engines(cutlet_factory=no_cutlet))
        self.assertEqual(result["lines"], ["yume o mita"])
        self.assertIn("cutlet ImportError", result["fallback"])


class FakeKakasi:
    READINGS = {"ら": "ra", "て": "te", "ね": "ne"}

    def __init__(self, segments):
        self.segments = segments

    def convert(self, text):
        if text in self.READINGS:
            return [{"orig": text, "hira": text, "hepburn": self.READINGS[text]}]
        return [{"orig": orig, "hira": hira, "hepburn": ""} for orig, hira in self.segments]


class SmallTsuTest(unittest.TestCase):
    def test_a_lone_small_tsu_doubles_the_next_consonant(self):
        kakasi = FakeKakasi([("ら", "ら"), ("っ", "っ"), ("て", "て")])
        self.assertEqual(kakasi_romaji.convert_text(kakasi, "らって"), "ratte")

    def test_a_lone_small_tsu_at_the_end_is_dropped(self):
        kakasi = FakeKakasi([("ね", "ね"), ("っ", "っ")])
        self.assertEqual(kakasi_romaji.convert_text(kakasi, "ねっ"), "ne")


class FallbackFailSafeTest(unittest.TestCase):
    def test_a_line_that_raises_is_kept_and_counted(self):
        class Broken:
            def convert(self, text):
                raise RuntimeError("dictionary error")

        result = romanize_lines(["ゆめ", "plain"], Engines(cutlet_factory=no_cutlet, kakasi_factory=Broken))
        self.assertEqual(result["lines"], ["ゆめ", "plain"])
        self.assertEqual(result["failed"], 1)

    def test_a_line_that_loses_characters_is_kept(self):
        class Lossy:
            def convert(self, text):
                return [{"orig": text[:1], "hira": "", "hepburn": ""}]

        result = romanize_lines(["ゆめのなか"], Engines(cutlet_factory=no_cutlet, kakasi_factory=Lossy))
        self.assertEqual(result["lines"], ["ゆめのなか"])
        self.assertEqual(result["failed"], 1)


if __name__ == "__main__":
    unittest.main()

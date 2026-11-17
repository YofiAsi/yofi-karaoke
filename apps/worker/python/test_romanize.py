"""Unit tests for romanize.py with invented lines. Run: python -m unittest discover -s apps/worker/python"""

import importlib.util
import io
import json
import sys
import unittest
from unittest import mock

import romanize
from romanize import Engines, romanize_lines

HAS_CUTLET = all(importlib.util.find_spec(name) is not None for name in ("cutlet", "fugashi", "unidic_lite"))
HAS_PYKAKASI = importlib.util.find_spec("pykakasi") is not None


def convert(*lines):
    return romanize_lines(list(lines))["lines"]


@unittest.skipUnless(HAS_CUTLET, "cutlet with unidic-lite is not installed")
class CutletConversionTest(unittest.TestCase):
    def test_hiragana_runs_get_word_spacing(self):
        self.assertEqual(convert("それはいつも", "きっとまたあえるよ"), ["sore wa itsumo", "kitto mata aeru yo"])
        self.assertEqual(convert("ずっと一緒にいようね", "だれかどこかで"), ["zutto issho ni iyou ne", "dareka dokoka de"])

    def test_particles_read_wa_e_o(self):
        self.assertEqual(convert("君は空へ走る", "夢をかなえたい"), ["kimi wa sora e hashiru", "yume o kanaetai"])
        self.assertEqual(convert("雨はやむ", "君はじめて"), ["ame wa yamu", "kimi hajimete"])

    def test_kanji_compounds_and_personal_readings(self):
        self.assertEqual(convert("永遠の約束", "私の夢"), ["eien no yakusoku", "watashi no yume"])
        self.assertEqual(convert("何をしていたの", "何回でも", "何と言う"), ["nani o shite ita no", "nankai demo", "nan to iu"])

    def test_katakana_loanwords_stay_as_sung(self):
        self.assertEqual(convert("コーヒーとケーキ", "ヴァイオリンとウォーター"), ["koohii to keeki", "vaiorin to wootaa"])
        self.assertEqual(convert("ラブ・ソング", "ティーンエイジャー"), ["rabu songu", "tiin'eijaa"])

    def test_small_tsu_and_long_vowels(self):
        self.assertEqual(convert("ちょっと待って", "あっ、雨", "えっ？"), ["chotto matte", "a, ame", "e?"])
        self.assertEqual(convert("おおきな声で", "ありがとう、東京"), ["ookina koe de", "arigatou, toukyou"])

    def test_mixed_latin_text_keeps_its_case(self):
        self.assertEqual(convert("Hello 今日は Happy day"), ["Hello kyou wa Happy day"])
        self.assertEqual(convert("I love you 君をまもる", "君Baby"), ["I love you kimi o mamoru", "kimi Baby"])

    def test_greetings_and_laughter(self):
        self.assertEqual(convert("こんにちは今日は", "ははは"), ["konnichiwa kyou wa", "hahaha"])

    def test_brackets_and_full_width_text(self):
        self.assertEqual(convert("「さあ」行こう", "ＬＯＶＥ １２３ ね"), ['"saa" ikou', "LOVE 123 ne"])

    def test_unreadable_han_characters_are_kept(self):
        self.assertEqual(convert("東京龘ね"), ["toukyou 龘 ne"])

    def test_enhanced_lrc_word_tags_stay_intact(self):
        self.assertEqual(convert("<00:01.00>君を<00:02.00>待つ"), ["<00:01.00>kimi o<00:02.00>matsu"])
        self.assertEqual(convert("<00:01.00>君 <00:02.50>待つ"), ["<00:01.00>kimi <00:02.50>matsu"])

    def test_empty_lines_and_order_are_kept(self):
        self.assertEqual(convert("夢", "", "青い空"), ["yume", "", "aoi sora"])

    def test_romaji_comes_back_unchanged(self):
        first = convert("それはいつも", "君を待っている", "さよなら、またね！")
        self.assertEqual(convert(*first), first)

    def test_cutlet_reports_no_fallback(self):
        self.assertIsNone(romanize_lines(["夢をみた"])["fallback"])


@unittest.skipUnless(HAS_CUTLET and HAS_PYKAKASI, "cutlet or pykakasi is not installed")
class EngineChoiceTest(unittest.TestCase):
    def test_digits_next_to_japanese_use_pykakasi(self):
        self.assertEqual(convert("3人で1日", "あの日の歌"), ["3 nin de 1 nichi", "ano hi no uta"])

    def test_a_line_cutlet_cannot_convert_falls_back_to_pykakasi(self):
        class BrokenCutlet:
            def tagger(self, text):
                raise RuntimeError("mecab error")

        result = romanize_lines(["夢をみた"], Engines(cutlet_factory=BrokenCutlet))
        self.assertEqual(result, {"lines": ["yume o mita"], "failed": 0, "unavailable": None, "fallback": None})


class UntouchedScriptsTest(unittest.TestCase):
    def test_chinese_with_one_stylistic_no_is_untouched(self):
        lines = ["今天天气很好我们一起走吧", "城市の夜晚灯火辉煌"]
        self.assertLess(romanize.kana_share("".join(lines)), romanize.MIN_KANA_SHARE)
        self.assertEqual(romanize_lines(lines, self.failing_engines())["lines"], lines)

    def test_chinese_only_text_is_untouched(self):
        lines = ["我们一起走吧", "今天天气很好"]
        expected = {"lines": lines, "failed": 0, "unavailable": None, "fallback": None}
        self.assertEqual(romanize_lines(lines, self.failing_engines()), expected)

    def test_hebrew_and_latin_are_untouched(self):
        lines = ["שיר על הים", "Dancing in the moonlight"]
        self.assertEqual(romanize_lines(lines, self.failing_engines())["lines"], lines)

    @staticmethod
    def failing_engines():
        def fail():
            raise AssertionError("no romanizer may load for text that is not Japanese")

        return Engines(cutlet_factory=fail, kakasi_factory=fail)


class FailSafeTest(unittest.TestCase):
    def test_missing_libraries_keep_the_original_lines(self):
        with mock.patch.dict(sys.modules, {"cutlet": None, "pykakasi": None}):
            result = romanize_lines(["夢をみた"])
        self.assertEqual(result["lines"], ["夢をみた"])
        self.assertIn("cutlet", result["unavailable"])
        self.assertIn("pykakasi", result["unavailable"])


class CommandLineTest(unittest.TestCase):
    def test_reads_lines_and_rejects_bad_input(self):
        self.assertEqual(romanize.read_lines(io.StringIO(json.dumps({"lines": ["a", "b"]}))), ["a", "b"])
        with self.assertRaises(ValueError):
            romanize.read_lines(io.StringIO(json.dumps({"lines": [1]})))


if __name__ == "__main__":
    unittest.main()

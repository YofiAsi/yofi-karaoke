"""Unit tests for the stem picker in separate.py. Run: python -m unittest discover -s apps/worker/python"""

import unittest
from pathlib import Path

from separate import StemPickError, pick_stems

OUT = Path("/out")
MODEL = "UVR-MDX-NET-Inst_HQ_3"


class PickStemsTest(unittest.TestCase):
    def test_two_named_stems(self):
        files = [f"song_(Vocals)_{MODEL}.mp3", f"song_(Instrumental)_{MODEL}.mp3"]
        instrumental, vocals = pick_stems(files, OUT)
        self.assertEqual(instrumental, OUT / files[1])
        self.assertEqual(vocals, OUT / files[0])

    def test_tokens_match_case_insensitively(self):
        files = [f"song_(VOCALS)_{MODEL}.mp3", f"song_(instrumental)_{MODEL}.mp3"]
        instrumental, vocals = pick_stems(files, OUT)
        self.assertEqual(instrumental, OUT / files[1])
        self.assertEqual(vocals, OUT / files[0])

    def test_vocals_falls_back_to_remaining_file(self):
        files = [f"song_(Instrumental)_{MODEL}.mp3", f"song_(Lead)_{MODEL}.mp3"]
        instrumental, vocals = pick_stems(files, OUT)
        self.assertEqual(instrumental, OUT / files[0])
        self.assertEqual(vocals, OUT / files[1])

    def test_instrumental_falls_back_to_remaining_file(self):
        files = [f"song_(Vocals)_{MODEL}.mp3", f"song_(Music)_{MODEL}.mp3"]
        instrumental, vocals = pick_stems(files, OUT)
        self.assertEqual(instrumental, OUT / files[1])
        self.assertEqual(vocals, OUT / files[0])

    def test_single_stem_yields_no_vocals(self):
        files = [f"song_(Instrumental)_{MODEL}.mp3"]
        instrumental, vocals = pick_stems(files, OUT)
        self.assertEqual(instrumental, OUT / files[0])
        self.assertIsNone(vocals)

    def test_single_unlabelled_stem_is_instrumental(self):
        instrumental, vocals = pick_stems(["song_out.mp3"], OUT)
        self.assertEqual(instrumental, OUT / "song_out.mp3")
        self.assertIsNone(vocals)

    def test_absolute_paths_are_kept(self):
        absolute = Path("/elsewhere") / f"song_(Instrumental)_{MODEL}.mp3"
        instrumental, _ = pick_stems([str(absolute)], OUT)
        self.assertEqual(instrumental, absolute)

    def test_only_vocals_fails(self):
        with self.assertRaises(StemPickError):
            pick_stems([f"song_(Vocals)_{MODEL}.mp3"], OUT)

    def test_ambiguous_multi_stem_fails(self):
        files = [f"song_(Drums)_{MODEL}.mp3", f"song_(Bass)_{MODEL}.mp3", f"song_(Other)_{MODEL}.mp3"]
        with self.assertRaises(StemPickError):
            pick_stems(files, OUT)


if __name__ == "__main__":
    unittest.main()

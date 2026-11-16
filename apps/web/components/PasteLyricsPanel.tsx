"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MAX_MANUAL_LYRICS_CHARS, checkManualLyrics } from "@/lib/manualLyrics";
import { shironetSearchUrl } from "@/lib/shironet";

type SendState = "idle" | "sending" | "sent" | "failed";

interface PasteLyricsPanelProps {
  songId: string;
  songTitle?: string;
}

function ShironetSearchLink({ songTitle }: { songTitle?: string }) {
  const url = songTitle ? shironetSearchUrl(songTitle) : null;
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      dir="rtl"
      className="self-start rounded-full border border-neutral-600 px-3 py-1.5 hover:bg-neutral-700"
    >
      חיפוש בשירונט ↗
    </a>
  );
}

const SEND_LABELS: Record<SendState, string> = {
  idle: "Save lyrics",
  sending: "Saving…",
  sent: "Save lyrics",
  failed: "Retry",
};

export function PasteLyricsPanel({ songId, songTitle }: PasteLyricsPanelProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");

  useEffect(() => {
    setOpen(false);
    setText("");
    setSendState("idle");
  }, [songId]);

  const check = checkManualLyrics(text);

  async function handleSave() {
    if (!check.ok) return;
    setSendState("sending");
    try {
      await api.post(`/api/songs/${songId}/lyrics/manual`, { text: check.text });
      setSendState("sent");
      setOpen(false);
      setText("");
    } catch (err) {
      console.error(err);
      setSendState("failed");
    }
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm text-neutral-300">
        <span className="text-neutral-400">{sendState === "sent" ? "Lyrics saved, syncing to the vocals…" : ""}</span>
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-neutral-600 px-3 py-1.5 hover:bg-neutral-700"
        >
          Paste lyrics
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm text-neutral-300">
      <ShironetSearchLink songTitle={songTitle} />
      <textarea
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_MANUAL_LYRICS_CHARS}
        rows={6}
        placeholder="One lyric line per row"
        aria-label="Lyrics for the current song"
        className="w-full rounded-xl bg-neutral-900 border border-neutral-700 p-3 text-base text-white text-start placeholder:text-neutral-500 focus:outline-none focus:border-neutral-400"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="tabular-nums text-neutral-500">
          {text.length}/{MAX_MANUAL_LYRICS_CHARS}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setOpen(false)}
            className="rounded-full px-3 py-1.5 hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!check.ok || sendState === "sending"}
            className="rounded-full bg-white px-3 py-1.5 font-semibold text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            {SEND_LABELS[sendState]}
          </button>
        </div>
      </div>
    </div>
  );
}

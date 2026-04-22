"use client";

import { useEffect } from "react";
import type { QueueItem, SongProgressEvent } from "@karaoke/shared";
import { QueueList } from "./QueueList";

interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  items: QueueItem[];
  progress: Map<string, SongProgressEvent>;
}

export function QueueDrawer({ open, onClose, items, progress }: QueueDrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Queue"
        className={`fixed bottom-0 left-0 right-0 z-50 bg-neutral-950 border-t border-neutral-800 rounded-t-2xl p-5 pb-10 max-h-[80vh] overflow-y-auto transition-transform duration-300 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Up next</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 text-sm px-2 py-1 rounded-lg hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
        <QueueList items={items} progress={progress} />
      </div>
    </>
  );
}

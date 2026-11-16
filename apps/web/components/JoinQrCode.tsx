"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { displayOrigin } from "@/lib/upNext";

interface JoinTarget {
  url: string;
  qrDataUrl: string;
}

async function buildJoinTarget(url: string): Promise<JoinTarget> {
  const qrDataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1, errorCorrectionLevel: "M" });
  return { url, qrDataUrl };
}

export function JoinQrCode() {
  const [target, setTarget] = useState<JoinTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildJoinTarget(window.location.origin)
      .then((built) => {
        if (!cancelled) setTarget(built);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) return null;

  return (
    <figure className="flex flex-col items-center gap-3">
      <img
        src={target.qrDataUrl}
        alt={`QR code to join at ${target.url}`}
        className="w-full max-w-[16rem] aspect-square rounded-xl bg-white p-2"
      />
      <figcaption className="text-center">
        <span className="block text-lg font-semibold">Scan to add a song</span>
        <span dir="ltr" className="block text-sm text-neutral-400 break-all">
          {displayOrigin(target.url)}
        </span>
      </figcaption>
    </figure>
  );
}

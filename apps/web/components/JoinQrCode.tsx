"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { displayOrigin, isLoopbackHost } from "@/lib/upNext";

interface JoinTarget {
  url: string;
  qrDataUrl: string;
  unreachable: boolean;
}

async function buildJoinTarget(location: Location): Promise<JoinTarget> {
  const url = location.origin;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1, errorCorrectionLevel: "M" });
  return { url, qrDataUrl, unreachable: isLoopbackHost(location.hostname) };
}

export function JoinQrCode() {
  const [target, setTarget] = useState<JoinTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildJoinTarget(window.location)
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
        {target.unreachable && (
          <span role="note" className="mt-2 block text-sm text-amber-400">
            Phones cannot reach this address. Open the TV page through the LAN address or the tunnel URL instead.
          </span>
        )}
      </figcaption>
    </figure>
  );
}

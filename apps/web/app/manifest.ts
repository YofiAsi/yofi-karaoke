import type { MetadataRoute } from "next";
import { BACKGROUND_COLOR } from "@/lib/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yofi Karaoke",
    short_name: "Karaoke",
    description: "Party karaoke: queue songs from your phone and sing along.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BACKGROUND_COLOR,
    theme_color: BACKGROUND_COLOR,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

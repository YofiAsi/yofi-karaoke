"use client";

import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  QueueUpdatedEvent,
  SongProgressEvent,
  PlaybackStateEvent,
  PlaybackTickEvent,
  HostChangedEvent,
  PlayerChangedEvent,
} from "@karaoke/shared";

// Typed server-to-client events
type ServerToClientEvents = {
  "queue:updated": (data: QueueUpdatedEvent) => void;
  "song:progress": (data: SongProgressEvent) => void;
  "playback:state": (data: PlaybackStateEvent) => void;
  "playback:tick": (data: PlaybackTickEvent) => void;
  "host:changed": (data: HostChangedEvent) => void;
  "player:changed": (data: PlayerChangedEvent) => void;
};

// Typed client-to-server events
type ClientToServerEvents = {
  // Emitted by the player phone when its <audio> fires "ended"
  "playback:ended": () => void;
};

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let _socket: AppSocket | null = null;

/**
 * Resolve the Socket.IO server URL.
 *
 * Next.js `rewrites()` cannot proxy WebSocket upgrades, so we can't route
 * Socket.IO through the web origin in local/docker setups. We connect the
 * browser directly to the api container's exposed port instead.
 *
 * Override via `NEXT_PUBLIC_WS_URL` for deployments where a real reverse
 * proxy (Dokploy/Traefik, nginx, etc.) terminates WSS on the public origin.
 */
function resolveSocketUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override && /^https?:\/\//.test(override)) return override;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000`;
}

/**
 * Returns the singleton socket instance, creating it lazily on first call.
 * autoConnect is false so the caller (useSocket) initiates the connection.
 */
export function getSocket(): AppSocket {
  if (!_socket) {
    _socket = io(resolveSocketUrl(), {
      path: "/socket.io",
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      withCredentials: true,
    });
  }
  return _socket;
}

/**
 * React hook that connects the singleton socket and keeps it alive for the
 * lifetime of the app. Components should remove their own listeners in their
 * own useEffect cleanup — this hook intentionally does NOT disconnect on
 * unmount so the shared singleton stays connected.
 */
export function useSocket(): AppSocket {
  const socket = getSocket();

  useEffect(() => {
    if (!socket.connected) socket.connect();
    // Intentionally no disconnect on unmount: the socket is a singleton shared
    // by all components. Individual components must clean up their own listeners.
  }, [socket]);

  return socket;
}

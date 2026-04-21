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

export type AppSocket = Socket<ServerToClientEvents, Record<string, never>>;

let _socket: AppSocket | null = null;

/**
 * Returns the singleton socket instance, creating it lazily on first call.
 * autoConnect is false so the caller (useSocket) initiates the connection.
 */
export function getSocket(): AppSocket {
  if (!_socket) {
    _socket = io({
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

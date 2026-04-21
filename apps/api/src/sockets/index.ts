import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "../env.js";

let io: Server;

export function setupSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
      credentials: true,
    },
    cookie: false,
  });

  io.on("connection", (socket) => {
    // Read cookie from handshake for identity (viewer mode allowed)
    const rawCookie = socket.handshake.headers.cookie ?? "";
    const cookieName = env.COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
    const userId = match ? decodeURIComponent(match[1]) : null;
    socket.data.userId = userId;

    socket.on("disconnect", () => {
      // no-op for now
    });
  });

  return io;
}

/**
 * Returns the initialised Socket.IO Server instance.
 * This is the canonical export of `io` — consumers import `getIO` because
 * `io` is lazily initialised and cannot be a static named export.
 */
export function getIO(): Server {
  if (!io) throw new Error("Socket.IO not initialised — call setupSocketIO first");
  return io;
}

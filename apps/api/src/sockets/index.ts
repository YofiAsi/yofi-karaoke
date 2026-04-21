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
    cookie: true,
  });

  io.on("connection", (socket) => {
    // Read karaoke_uid cookie from handshake for identity (viewer mode allowed)
    const rawCookie = socket.handshake.headers.cookie ?? "";
    const match = rawCookie.match(/(?:^|;\s*)karaoke_uid=([^;]+)/);
    const userId = match ? decodeURIComponent(match[1]) : null;
    socket.data.userId = userId;

    socket.on("disconnect", () => {
      // no-op for now
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.IO not initialised — call setupSocketIO first");
  return io;
}

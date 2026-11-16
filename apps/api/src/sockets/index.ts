import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "../env.js";
import { resolveCorsOrigin } from "../auth/corsPolicy.js";
import { readUserIdFromCookieHeader } from "../auth/signedUserId.js";

let io: Server;

export function setupSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: resolveCorsOrigin(env.CORS_ORIGINS),
      credentials: true,
    },
    cookie: false,
  });

  io.on("connection", (socket) => {
    socket.data.userId = readUserIdFromCookieHeader(
      socket.handshake.headers.cookie,
      env.COOKIE_NAME,
      env.SESSION_SECRET,
    );
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.IO not initialised: call setupSocketIO first");
  return io;
}

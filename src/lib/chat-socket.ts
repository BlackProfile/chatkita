"use client";

import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "./chat-types";

/**
 * Create a dedicated socket connection to the chat-service mini service.
 * Each view (customer chat / admin panel) creates its own connection and
 * MUST disconnect it on unmount.
 *
 * Never put a port in the URL — the gateway routes via XTransformPort.
 */
export function createChatSocket(): Socket {
  return io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 10000,
  });
}

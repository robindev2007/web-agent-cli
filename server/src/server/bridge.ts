import { CONFIG } from "../config";
import type { GeminiBrowserProvider } from "../providers";

export function createBridgeServer(provider: GeminiBrowserProvider) {
  const server = Bun.serve({
    port: CONFIG.SERVER.PORT,
    hostname: CONFIG.SERVER.HOST,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === CONFIG.SERVER.WS_PATH || req.headers.get("upgrade") === "websocket") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined;
      }
      return new Response(`Gemini Bridge Server running on http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}`);
    },
    websocket: {
      open(ws) {
        console.log("\n\x1b[32m[Bridge] Chrome Extension connected via WebSocket!\x1b[0m\n");
        provider.attachClient(ws);
      },
      message(_ws, message) {
        try {
          const data = JSON.parse(typeof message === "string" ? message : message.toString());
          if (data.type === "STATUS") {
            console.log(`\x1b[36m[Extension Status]:\x1b[0m ${data.message}`);
            return;
          }
          provider.handleMessage(data);
        } catch (e) {
          console.error("\x1b[31m[Bridge] Message parse error:\x1b[0m", e);
        }
      },
      close(ws) {
        console.log("\n\x1b[33m[Bridge] Chrome Extension disconnected.\x1b[0m\n");
        provider.detachClient(ws);
      },
    },
  });

  return server;
}


import { CONFIG } from "../config";
import type { GeminiBrowserProvider } from "../providers";
import { handleOpenCodeRequest } from "../adapters/opencode";

export function createBridgeServer(provider: GeminiBrowserProvider) {
  const server = Bun.serve({
    port: CONFIG.SERVER.PORT,
    hostname: CONFIG.SERVER.HOST,
    idleTimeout: 255, // Prevent Bun from killing long streaming connections after 10s
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket Upgrade for Chrome Extension
      if (url.pathname === CONFIG.SERVER.WS_PATH || req.headers.get("upgrade") === "websocket") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined;
      }

      // OpenCode Adapter (OpenAI-Compatible /v1/models and /v1/chat/completions)
      const opencodeResponse = await handleOpenCodeRequest(req, provider);
      if (opencodeResponse) return opencodeResponse;

      return new Response(
        `⚡ web-agent-cli Bridge Server running on http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}\n` +
        `• Chrome Extension WebSocket: ws://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}${CONFIG.SERVER.WS_PATH}\n` +
        `• OpenCode Adapter Endpoint: http://${CONFIG.SERVER.HOST}:${CONFIG.SERVER.PORT}/v1/chat/completions\n` +
        `• Status: ${provider.isReady() ? "ONLINE (Chrome connected)" : "WAITING_CHROME"}\n`,
        { headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
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


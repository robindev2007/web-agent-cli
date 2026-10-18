import { CONFIG } from "./src/config";
import { GeminiBrowserProvider } from "./src/providers";
import { createBridgeServer } from "./src/server/bridge";
import { startTerminalUI } from "./src/cli/terminal";

// 1. Initialize Root Bridge Provider
const rootProvider = new GeminiBrowserProvider("mother", "Mother (Lead Architect)");

// 2. Start WebSocket Bridge Server
createBridgeServer(rootProvider);

// 3. Start Multi-Agent Swarm UI
startTerminalUI();

import type { AIProvider } from "./types";

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  onStream?: (chunk: string, fullText: string) => void;
  timer: any;
}

export class GeminiBrowserProvider implements AIProvider {
  public readonly name: string;
  public readonly agentId: string;
  private static sharedSocket: any = null;
  private static pending = new Map<string, PendingRequest>();
  private static tabResetListeners = new Set<(agentId: string) => void>();

  public onTabReset?: () => void;

  constructor(agentId: string = "mother", name: string = "Mother (Coordinator)") {
    this.agentId = agentId;
    this.name = name;

    GeminiBrowserProvider.tabResetListeners.add((resetAgentId) => {
      if (resetAgentId === this.agentId) {
        this.onTabReset?.();
      }
    });
  }

  public attachClient(ws: any) {
    GeminiBrowserProvider.sharedSocket = ws;
  }

  public detachClient(ws: any) {
    if (GeminiBrowserProvider.sharedSocket === ws) {
      GeminiBrowserProvider.sharedSocket = null;
    }
  }

  public isReady(): boolean {
    return GeminiBrowserProvider.sharedSocket !== null;
  }

  public handleMessage(message: any) {
    if (!message) return;

    // Handle broadcast or unsolicited tab reset notifications
    if (message.type === "TAB_RESET" && message.agentId) {
      for (const listener of GeminiBrowserProvider.tabResetListeners) {
        listener(message.agentId);
      }
      return;
    }

    if (!message.id) return;

    const request = GeminiBrowserProvider.pending.get(message.id);
    if (!request) return;

    // Real-time chunk stream from Gemini DOM
    if (message.type === "GEMINI_STREAM") {
      request.onStream?.(message.chunk, message.fullText);
      return;
    }

    clearTimeout(request.timer);
    GeminiBrowserProvider.pending.delete(message.id);

    if (message.type === "GEMINI_RESPONSE") {
      request.resolve(message.text);
    } else if (message.type === "TAB_RESET_SUCCESS") {
      request.resolve(message.tabId ? String(message.tabId) : "OK");
    } else if (message.type === "ERROR") {
      request.reject(new Error(message.error || "Unknown error from extension"));
    }
  }

  /**
   * Request the Chrome extension to close the current tab and spawn a fresh tab for this agent
   */
  public async resetTab(timeoutMs: number = 20000): Promise<void> {
    if (!this.isReady()) {
      throw new Error("Chrome Extension is not connected.");
    }

    const id = Math.random().toString(36).substring(2, 9);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        GeminiBrowserProvider.pending.delete(id);
        reject(new Error(`Timed out waiting for fresh tab creation for agent '${this.agentId}'`));
      }, timeoutMs);

      GeminiBrowserProvider.pending.set(id, {
        resolve: () => {
          this.onTabReset?.();
          resolve();
        },
        reject,
        timer,
      });

      GeminiBrowserProvider.sharedSocket.send(
        JSON.stringify({
          id,
          agentId: this.agentId,
          type: "RESET_TAB",
        })
      );
    });
  }

  /**
   * Request the Chrome extension to immediately close and delete the browser tab for this agent to free RAM
   */
  public async closeTab(timeoutMs: number = 10000): Promise<void> {
    if (!this.isReady()) return;

    const id = Math.random().toString(36).substring(2, 9);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        GeminiBrowserProvider.pending.delete(id);
        resolve(); // Don't throw if tab close takes time, treat as best-effort cleanup
      }, timeoutMs);

      GeminiBrowserProvider.pending.set(id, {
        resolve: () => resolve(),
        reject,
        timer,
      });

      GeminiBrowserProvider.sharedSocket.send(
        JSON.stringify({
          id,
          agentId: this.agentId,
          type: "CLOSE_TAB",
        })
      );
    });
  }

  /**
   * Send prompt to the specific browser tab allocated for this agent with live stream callback
   */
  public async sendPrompt(
    prompt: string,
    timeoutMs: number = 180000,
    onStream?: (chunk: string, fullText: string) => void
  ): Promise<string> {
    if (!this.isReady()) {
      throw new Error("Chrome Extension is not connected. Ensure Chrome is running with Gemini Agent extension loaded.");
    }

    const id = Math.random().toString(36).substring(2, 9);

    // Stream stall watchdog: if no new tokens arrive for 25s, reject so the loop can recover
    const STALL_TIMEOUT_MS = 25_000;
    // Allow up to 35s for initial Gemini response (fresh tabs take 5-10s to load & compile)
    const INITIAL_RESPONSE_TIMEOUT_MS = 35_000;
    let streamStarted = false;
    let stallTimer: any = null;
    let initialTimer: any = null;

    const wrappedOnStream = onStream
      ? (chunk: string, fullText: string) => {
          if (!streamStarted) {
            streamStarted = true;
            if (initialTimer) {
              clearTimeout(initialTimer);
              initialTimer = null;
            }
          }

          // Reset stall watchdog on every chunk
          if (stallTimer) {
            clearTimeout(stallTimer);
          }
          stallTimer = setTimeout(() => {
            const request = GeminiBrowserProvider.pending.get(id);
            if (request) {
              clearTimeout(request.timer);
              GeminiBrowserProvider.pending.delete(id);
              request.reject(
                new Error(
                  `Agent '${this.agentId}' stream stalled — no new tokens for ${STALL_TIMEOUT_MS / 1000}s`
                )
              );
            }
          }, STALL_TIMEOUT_MS);

          onStream(chunk, fullText);
        }
      : undefined;

    return new Promise((resolve, reject) => {
      // If AI doesn't begin generating or streaming within 15s, recover immediately
      initialTimer = setTimeout(() => {
        if (!streamStarted) {
          const request = GeminiBrowserProvider.pending.get(id);
          if (request) {
            clearTimeout(request.timer);
            if (stallTimer) clearTimeout(stallTimer);
            GeminiBrowserProvider.pending.delete(id);
            request.reject(
              new Error(
                `Agent '${this.agentId}' planning timeout — no response within ${INITIAL_RESPONSE_TIMEOUT_MS / 1000}s`
              )
            );
          }
        }
      }, INITIAL_RESPONSE_TIMEOUT_MS);

      const timer = setTimeout(() => {
        if (stallTimer) clearTimeout(stallTimer);
        if (initialTimer) clearTimeout(initialTimer);
        GeminiBrowserProvider.pending.delete(id);
        reject(new Error(`Timed out waiting for agent '${this.agentId}' response after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      const wrappedResolve = (text: string) => {
        if (stallTimer) clearTimeout(stallTimer);
        if (initialTimer) clearTimeout(initialTimer);
        resolve(text);
      };

      const wrappedReject = (err: Error) => {
        if (stallTimer) clearTimeout(stallTimer);
        if (initialTimer) clearTimeout(initialTimer);
        reject(err);
      };

      GeminiBrowserProvider.pending.set(id, {
        resolve: wrappedResolve,
        reject: wrappedReject,
        onStream: wrappedOnStream,
        timer,
      });

      GeminiBrowserProvider.sharedSocket.send(
        JSON.stringify({
          id,
          agentId: this.agentId,
          type: "SEND_PROMPT",
          prompt,
        })
      );
    });
  }
}

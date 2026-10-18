export default defineBackground(() => {
  console.log(
    "%c[Gemini Multi-Agent Background] Initialized",
    "color: #38bdf8; font-weight: bold;",
  );

  let socket: WebSocket | null = null;
  let reconnectTimer: any = null;
  let connectionState: "DISCONNECTED" | "CONNECTING" | "CONNECTED" =
    "DISCONNECTED";

  // Map of agentId -> chrome tabId
  const agentTabs = new Map<string, number>();

  function updateState(newState: "DISCONNECTED" | "CONNECTING" | "CONNECTED") {
    connectionState = newState;
    chrome.storage.local.set({
      bridgeConnectionState: newState,
      lastBridgeCheck: Date.now(),
    });
  }

  /**
   * Closes any existing tab for an agent and opens a fresh, clean Gemini tab
   */
  async function createFreshTabForAgent(agentId: string): Promise<number> {
    if (agentTabs.has(agentId)) {
      const oldTabId = agentTabs.get(agentId)!;
      try {
        await chrome.tabs.remove(oldTabId);
        console.log(
          `[Multi-Agent] Closed previous tab ${oldTabId} for agent "${agentId}"`,
        );
      } catch {}
      agentTabs.delete(agentId);
    }

    console.log(
      `%c[Multi-Agent] Spawning fresh dedicated browser tab for agent: "${agentId}"...`,
      "color: #a78bfa; font-weight: bold;",
    );

    const newTab = await chrome.tabs.create({
      url: "https://gemini.google.com/app",
      active: true,
    });
    const tabId = newTab.id!;
    agentTabs.set(agentId, tabId);

    // Wait for the new tab to finish loading
    await new Promise<void>((resolve) => {
      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 2000);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/content.js"],
      });
      await new Promise((r) => setTimeout(r, 400));
    } catch (e: any) {
      console.warn(`[Multi-Agent] Script injection note: ${e.message}`);
    }

    return tabId;
  }

  /**
   * Get or create a dedicated tab for a specific agent (e.g. "mother", "reviewer", "sub_1", etc.)
   */
  async function getOrCreateTabForAgent(
    agentId: string = "mother",
  ): Promise<number> {
    // 1. Check if we already have an active tab mapped to this agent
    if (agentTabs.has(agentId)) {
      const existingTabId = agentTabs.get(agentId)!;
      try {
        const tab = await chrome.tabs.get(existingTabId);
        if (tab && tab.url?.includes("gemini.google.com/app")) {
          return existingTabId;
        }
      } catch {
        agentTabs.delete(agentId);
      }
    }

    // 2. If it's the "mother" agent, try reusing an already open unassigned gemini tab
    if (agentId === "mother") {
      const openTabs = await chrome.tabs.query({
        url: "https://gemini.google.com/app*",
      });
      if (openTabs.length > 0 && openTabs[0].id) {
        agentTabs.set("mother", openTabs[0].id);
        await chrome.tabs.update(openTabs[0].id, { active: true });
        return openTabs[0].id;
      }
    }

    // 3. Otherwise, create a fresh tab
    return await createFreshTabForAgent(agentId);
  }

  function connectBridge() {
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    updateState("CONNECTING");
    try {
      socket = new WebSocket("ws://127.0.0.1:3000/ws");

      socket.onopen = () => {
        updateState("CONNECTED");
        console.log(
          "%c[Background] Connected to Local Bridge on 127.0.0.1:3000!",
          "color: #34d399; font-weight: bold;",
        );
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        socket?.send(
          JSON.stringify({
            type: "STATUS",
            message: "Chrome multi-agent extension connected",
          }),
        );
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          const agentId = data.agentId || "mother";

          /**
           * Closes the active tab for an agent immediately to free RAM
           */
          async function closeTabForAgent(agentId: string): Promise<void> {
            if (agentTabs.has(agentId)) {
              const tabId = agentTabs.get(agentId)!;
              try {
                await chrome.tabs.remove(tabId);
                console.log(
                  `[Multi-Agent] Successfully closed & purged tab ${tabId} for agent "${agentId}" (RAM freed)`,
                );
              } catch {}
              agentTabs.delete(agentId);
            }
          }

          // Manual Tab Reset Command
          if (data.type === "RESET_TAB") {
            try {
              await closeTabForAgent(agentId);
              const freshTabId = await createFreshTabForAgent(agentId);
              socket?.send(
                JSON.stringify({
                  id: data.id,
                  agentId,
                  type: "TAB_RESET_SUCCESS",
                  tabId: freshTabId,
                }),
              );
            } catch (err: any) {
              socket?.send(
                JSON.stringify({
                  id: data.id,
                  agentId,
                  type: "ERROR",
                  error: `Failed to reset tab: ${err.message}`,
                }),
              );
            }
            return;
          }

          // Close Tab Command to free RAM
          if (data.type === "CLOSE_TAB") {
            await closeTabForAgent(agentId);
            socket?.send(
              JSON.stringify({
                id: data.id,
                agentId,
                type: "TAB_CLOSED_SUCCESS",
              }),
            );
            return;
          }

          if (data.type === "SEND_PROMPT") {
            const sendPromptWithAutoRecovery = async (
              tabId: number,
              isRetry: boolean = false,
            ) => {
              const triggerTabRecovery = async (errorReason: string) => {
                console.warn(
                  `[Multi-Agent] Prompt delivery failed for "${agentId}" on tab ${tabId}: ${errorReason}`,
                );

                if (!isRetry) {
                  console.log(
                    `%c[Multi-Agent] Tab unresponsive. Closing tab ${tabId} and spawning a fresh tab for "${agentId}"...`,
                    "color: #f59e0b; font-weight: bold;",
                  );

                  socket?.send(
                    JSON.stringify({
                      type: "STATUS",
                      message: `AI tab failed for agent ${agentId} (${errorReason}). Created fresh tab and retrying...`,
                    }),
                  );

                  socket?.send(
                    JSON.stringify({
                      type: "TAB_RESET",
                      agentId,
                      reason: errorReason,
                    }),
                  );

                  try {
                    const freshTabId = await createFreshTabForAgent(agentId);
                    await sendPromptWithAutoRecovery(freshTabId, true);
                  } catch (freshErr: any) {
                    socket?.send(
                      JSON.stringify({
                        id: data.id,
                        agentId,
                        type: "ERROR",
                        error: `Failed to create fresh tab: ${freshErr.message}`,
                      }),
                    );
                  }
                } else {
                  // Already tried on fresh tab
                  socket?.send(
                    JSON.stringify({
                      id: data.id,
                      agentId,
                      type: "ERROR",
                      error: `Failed even after fresh tab creation: ${errorReason}`,
                    }),
                  );
                }
              };

              // 1. Check content script availability
              chrome.tabs.sendMessage(tabId, { type: "PING" }, async () => {
                if (chrome.runtime.lastError) {
                  try {
                    await chrome.scripting.executeScript({
                      target: { tabId },
                      files: ["content-scripts/content.js"],
                    });
                    await new Promise((r) => setTimeout(r, 400));
                  } catch (injectErr: any) {
                    await triggerTabRecovery(
                      "Content script injection failed: " + injectErr.message,
                    );
                    return;
                  }
                }

                // 2. Inject Prompt
                chrome.tabs.sendMessage(
                  tabId,
                  { type: "SEND_PROMPT", prompt: data.prompt },
                  async (res) => {
                    if (chrome.runtime.lastError || !res?.success) {
                      const sendErr =
                        res?.error ||
                        chrome.runtime.lastError?.message ||
                        "Failed to inject prompt into Gemini";
                      await triggerTabRecovery(sendErr);
                      return;
                    }

                    // 3. Extract Response with real-time stream relay
                    chrome.tabs.sendMessage(
                      tabId,
                      { type: "GET_RESPONSE", requestId: data.id },
                      async (respResult) => {
                        if (chrome.runtime.lastError || !respResult?.success) {
                          const respErr =
                            respResult?.error ||
                            chrome.runtime.lastError?.message ||
                            "Error extracting Gemini response";
                          await triggerTabRecovery(respErr);
                        } else {
                          socket?.send(
                            JSON.stringify({
                              id: data.id,
                              agentId,
                              type: "GEMINI_RESPONSE",
                              text: respResult.text,
                            }),
                          );
                        }
                      },
                    );
                  },
                );
              });
            };

            const initialTabId = await getOrCreateTabForAgent(agentId);
            try {
              // Switch/focus to active tab so Chrome runs it at full speed without background throttling
              await chrome.tabs.update(initialTabId, { active: true });
            } catch {}
            await sendPromptWithAutoRecovery(initialTabId, false);
          }
        } catch (e: any) {
          console.error("[Background] Error processing message:", e);
        }
      };

      socket.onclose = () => {
        updateState("DISCONNECTED");
        socket = null;
        scheduleReconnect();
      };

      socket.onerror = () => {
        updateState("DISCONNECTED");
        socket?.close();
      };
    } catch {
      updateState("DISCONNECTED");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectBridge();
      }, 3000);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GEMINI_STREAM_CHUNK") {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            id: msg.requestId,
            type: "GEMINI_STREAM",
            chunk: msg.chunk,
            fullText: msg.fullText,
          }),
        );
      }
      return;
    }

    if (msg.type === "CHECK_BRIDGE_STATUS") {
      sendResponse({ state: connectionState });
      if (connectionState === "DISCONNECTED") {
        connectBridge();
      }
    }
  });

  // Track tab closures to prune dead agents
  chrome.tabs.onRemoved.addListener((closedTabId) => {
    for (const [agentId, tabId] of agentTabs.entries()) {
      if (tabId === closedTabId) {
        agentTabs.delete(agentId);
        console.log(`[Multi-Agent] Pruned closed tab for agent: ${agentId}`);
      }
    }
  });

  connectBridge();
});

import type { GeminiBrowserProvider } from "../providers";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-requested-with",
};

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string }>;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

/**
 * Format chat message history into structured text for Gemini DOM injection
 */
export function formatMessagesForGemini(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) return "";

  const formattedParts: string[] = [];

  for (const m of messages) {
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content.map((c) => c.text || "").filter(Boolean).join("\n");
    }

    if (!text.trim()) continue;

    if (m.role === "system") {
      formattedParts.push(`[SYSTEM INSTRUCTIONS]:\n${text}`);
    } else if (m.role === "assistant") {
      formattedParts.push(`[ASSISTANT]:\n${text}`);
    } else if (m.role === "tool") {
      formattedParts.push(`[TOOL RESULT]:\n${text}`);
    } else {
      formattedParts.push(`[USER]:\n${text}`);
    }
  }

  return formattedParts.join("\n\n");
}

/**
 * Handle OpenAI-compatible API requests from OpenCode CLI / IDE extensions
 */
export async function handleOpenCodeRequest(
  req: Request,
  provider: GeminiBrowserProvider
): Promise<Response | null> {
  const url = new URL(req.url);

  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. GET /v1/models — Model discovery endpoint for OpenCode
  if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
    const modelsResponse = {
      object: "list",
      data: [
        {
          id: "gemini-browser",
          object: "model",
          created: 1700000000,
          owned_by: "web-agent-cli",
          permission: [],
          root: "gemini-browser",
          parent: null,
        },
        {
          id: "gemini-browser-mother",
          object: "model",
          created: 1700000000,
          owned_by: "web-agent-cli",
          permission: [],
          root: "gemini-browser-mother",
          parent: null,
        },
        {
          id: "gemini-browser-worker",
          object: "model",
          created: 1700000000,
          owned_by: "web-agent-cli",
          permission: [],
          root: "gemini-browser-worker",
          parent: null,
        },
      ],
    };

    return new Response(JSON.stringify(modelsResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  }

  // 3. POST /v1/chat/completions — Main chat & agent prompt routing
  if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
    let body: ChatCompletionRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          error: {
            message: "Invalid JSON request body",
            type: "invalid_request_error",
            code: "bad_json",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    if (!provider.isReady()) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Chrome extension is not connected to web-agent-cli. Ensure Chrome is running with Gemini tab open.",
            type: "server_error",
            code: "browser_disconnected",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    const completionId = `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const modelId = body.model || "gemini-browser";
    const promptText = formatMessagesForGemini(body.messages || []);

    if (!promptText.trim()) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Empty messages provided in request",
            type: "invalid_request_error",
            code: "empty_messages",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    // ── Streaming Mode (OpenCode default) ──────────────────────────────────
    if (body.stream) {
      const encoder = new TextEncoder();
      let isClosed = false;

      const stream = new ReadableStream({
        async start(controller) {
          const safeEnqueue = (payload: string) => {
            if (isClosed) return;
            try {
              controller.enqueue(encoder.encode(payload));
            } catch {
              isClosed = true;
            }
          };

          const safeClose = () => {
            if (isClosed) return;
            isClosed = true;
            try {
              controller.close();
            } catch {}
          };

          // Heartbeat keep-alive to keep connection alive during Gemini thinking
          const keepalive = setInterval(() => {
            if (isClosed) {
              clearInterval(keepalive);
              return;
            }
            safeEnqueue(": keepalive\n\n");
          }, 3000);

          try {
            await provider.sendPrompt(
              promptText,
              180000,
              (chunk: string) => {
                if (isClosed) return;
                const sseData = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: modelId,
                  choices: [
                    {
                      index: 0,
                      delta: { content: chunk },
                      finish_reason: null,
                    },
                  ],
                };
                safeEnqueue(`data: ${JSON.stringify(sseData)}\n\n`);
              }
            );

            // Final stop chunk
            const finalChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelId,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            };
            safeEnqueue(`data: ${JSON.stringify(finalChunk)}\n\n`);
            safeEnqueue("data: [DONE]\n\n");
          } catch (err: any) {
            const errChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelId,
              choices: [
                {
                  index: 0,
                  delta: { content: `\n\n[Error from Gemini Browser]: ${err.message || String(err)}` },
                  finish_reason: "stop",
                },
              ],
            };
            safeEnqueue(`data: ${JSON.stringify(errChunk)}\n\n`);
            safeEnqueue("data: [DONE]\n\n");
          } finally {
            clearInterval(keepalive);
            safeClose();
          }
        },
        cancel() {
          isClosed = true;
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...CORS_HEADERS,
        },
      });
    }

    // ── Non-Streaming Mode ────────────────────────────────────────────────
    try {
      const fullResponse = await provider.sendPrompt(promptText, 180000);

      const completionResponse = {
        id: completionId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: fullResponse,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: Math.ceil(promptText.length / 4),
          completion_tokens: Math.ceil(fullResponse.length / 4),
          total_tokens: Math.ceil((promptText.length + fullResponse.length) / 4),
        },
      };

      return new Response(JSON.stringify(completionResponse), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          error: {
            message: err.message || "Failed to process prompt through Gemini Browser",
            type: "server_error",
            code: "provider_error",
          },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }
  }

  // Not handled by OpenCode adapter
  return null;
}

/**
 * Returns the recommended opencode.json configuration object
 */
export function generateOpenCodeConfig(port: number = 3000): object {
  return {
    $schema: "https://opencode.ai/config.json",
    model: "web-agent/gemini-browser",
    provider: {
      "web-agent": {
        npm: "@ai-sdk/openai-compatible",
        name: "Web Agent CLI (Gemini Browser)",
        options: {
          baseURL: `http://127.0.0.1:${port}/v1`,
          apiKey: "ignored",
        },
        models: {
          "gemini-browser": {
            name: "Gemini Browser Agent",
          },
          "gemini-browser-mother": {
            name: "Gemini Mother Architect",
          },
          "gemini-browser-worker": {
            name: "Gemini Isolated Worker",
          },
        },
      },
    },
  };
}


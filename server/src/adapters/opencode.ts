import type { GeminiBrowserProvider } from "../providers";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-requested-with",
};

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string }> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: any;
  };
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: ChatCompletionTool[];
  tool_choice?: any;
}

/**
 * Parses tool calls formatted by Gemini into structured OpenAI tool calls
 */
export function parseToolCallsFromResponse(rawText: string): {
  cleanContent: string;
  toolCalls: OpenAIToolCall[];
} {
  const toolCalls: OpenAIToolCall[] = [];
  let cleanContent = rawText;

  // 1. Match Gemini/OpenCode CLI syntax:
  // [tool_call: bash for 'npx create-next-app...' working_dir='D:/robin']
  // or tool_call: bash for '...'
  const bashForRegex = /\[?tool_call:\s*([a-zA-Z0-9_\-]+)\s+for\s+['"]([\s\S]*?)['"](?:\s+working_dir=['"]([\s\S]*?)['"])?\]?/gi;
  let match: RegExpExecArray | null;
  while ((match = bashForRegex.exec(rawText)) !== null) {
    const toolName = match[1];
    let command = match[2];
    const workingDir = match[3];

    // Ensure npx has -y so non-interactive execution never hangs on prompt
    if (command.startsWith("npx ") && !command.includes(" -y ") && !command.startsWith("npx -y ")) {
      command = command.replace(/^npx\s+/, "npx -y ");
    }

    const args: Record<string, any> = { command };
    if (workingDir) {
      args.working_dir = workingDir;
    }

    toolCalls.push({
      id: `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      type: "function",
      function: {
        name: toolName,
        arguments: JSON.stringify(args),
      },
    });

    cleanContent = cleanContent.replace(match[0], "").trim();
  }

  // 2. Match JSON code blocks: ```tool_call ... ``` or ```json ... ```
  const jsonBlockRegex = /```(?:tool_call|json)?\s*\n?(\{\s*[\s\S]*?"(?:name|tool)"\s*:[\s\S]*?\})\s*```/gi;
  while ((match = jsonBlockRegex.exec(rawText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const toolName = parsed.name || parsed.tool;
      const rawArgs = parsed.arguments || parsed.args || parsed.params || parsed.parameters || parsed;
      let argsObj: Record<string, any> = {};

      if (typeof rawArgs === "string") {
        try {
          argsObj = JSON.parse(rawArgs);
        } catch {
          argsObj = { command: rawArgs };
        }
      } else if (typeof rawArgs === "object" && rawArgs !== null) {
        argsObj = { ...rawArgs };
        delete argsObj.name;
        delete argsObj.tool;
      }

      if (toolName && typeof toolName === "string") {
        if (argsObj.command && typeof argsObj.command === "string") {
          if (argsObj.command.startsWith("npx ") && !argsObj.command.includes(" -y ") && !argsObj.command.startsWith("npx -y ")) {
            argsObj.command = argsObj.command.replace(/^npx\s+/, "npx -y ");
          }
        }

        toolCalls.push({
          id: `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(argsObj),
          },
        });

        cleanContent = cleanContent.replace(match[0], "").trim();
      }
    } catch {}
  }

  // 3. Match XML tag: <tool_call> ... </tool_call>
  const xmlTagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((match = xmlTagRegex.exec(rawText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const toolName = parsed.name || parsed.tool;
      const rawArgs = parsed.arguments || parsed.args || parsed;
      const argsObj = typeof rawArgs === "object" && rawArgs !== null ? { ...rawArgs } : { input: rawArgs };
      delete argsObj.name;
      delete argsObj.tool;

      if (toolName && typeof toolName === "string") {
        toolCalls.push({
          id: `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(argsObj),
          },
        });

        cleanContent = cleanContent.replace(match[0], "").trim();
      }
    } catch {}
  }

  return { cleanContent, toolCalls };
}

/**
 * Format chat message history into structured text for Gemini DOM injection
 */
export function formatMessagesForGemini(
  messages: ChatMessage[],
  tools?: ChatCompletionTool[]
): string {
  if (!messages || messages.length === 0) return "";

  const formattedParts: string[] = [];

  // Inject available tools into guidance so Gemini knows what tools exist and how to call them
  if (tools && tools.length > 0) {
    const toolList = tools
      .map((t) => {
        const params = t.function.parameters?.properties
          ? Object.keys(t.function.parameters.properties).join(", ")
          : "";
        return `- ${t.function.name}: ${t.function.description || ""}${params ? ` (parameters: ${params})` : ""}`;
      })
      .join("\n");

    formattedParts.push(
      `[SYSTEM - TOOL CALLING CAPABILITY]:\nYou have access to the following workspace tools:\n${toolList}\n\n` +
      `When you need to run commands or interact with the project, invoke tools using this format:\n` +
      `[tool_call: tool_name for 'command' working_dir='dir']\n` +
      `OR\n` +
      `\`\`\`tool_call\n{"name": "tool_name", "arguments": {"param": "value"}}\n\`\`\`\n` +
      `Always perform the action directly via tool calls rather than asking the user.`
    );
  }

  for (const m of messages) {
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content.map((c) => c.text || "").filter(Boolean).join("\n");
    }

    if (m.role === "assistant") {
      let part = text ? `[ASSISTANT]:\n${text}` : "";
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          part += `\n[ASSISTANT CALLED TOOL: ${tc.function.name}]\nArguments: ${tc.function.arguments}`;
        }
      }
      if (part.trim()) formattedParts.push(part.trim());
      continue;
    }

    if (!text.trim()) continue;

    if (m.role === "system") {
      formattedParts.push(`[SYSTEM INSTRUCTIONS]:\n${text}`);
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
    const promptText = formatMessagesForGemini(body.messages || [], body.tools);

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

          let fullResponseText = "";
          let streamedIndex = 0;

          try {
            const rawResponse = await provider.sendPrompt(
              promptText,
              180000,
              (chunk: string) => {
                if (isClosed) return;
                fullResponseText += chunk;

                // Stream content safely as long as it doesn't enter a tool call syntax
                const toolCallMarker = fullResponseText.search(/\[?tool_call:|```(?:tool_call|json)?|<tool_call/i);
                if (toolCallMarker === -1) {
                  if (fullResponseText.length > streamedIndex) {
                    const deltaText = fullResponseText.slice(streamedIndex);
                    streamedIndex = fullResponseText.length;
                    const sseData = {
                      id: completionId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: modelId,
                      choices: [
                        {
                          index: 0,
                          delta: { content: deltaText },
                          finish_reason: null,
                        },
                      ],
                    };
                    safeEnqueue(`data: ${JSON.stringify(sseData)}\n\n`);
                  }
                } else if (toolCallMarker > streamedIndex) {
                  const deltaText = fullResponseText.slice(streamedIndex, toolCallMarker);
                  streamedIndex = toolCallMarker;
                  if (deltaText.trim()) {
                    const sseData = {
                      id: completionId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: modelId,
                      choices: [
                        {
                          index: 0,
                          delta: { content: deltaText },
                          finish_reason: null,
                        },
                      ],
                    };
                    safeEnqueue(`data: ${JSON.stringify(sseData)}\n\n`);
                  }
                }
              }
            );

            const responseToParse = rawResponse || fullResponseText;
            const { cleanContent, toolCalls } = parseToolCallsFromResponse(responseToParse);

            if (toolCalls.length > 0) {
              // Emit any clean conversational text that wasn't streamed yet
              if (cleanContent && cleanContent.length > streamedIndex) {
                const remaining = cleanContent.slice(streamedIndex);
                if (remaining.trim()) {
                  safeEnqueue(`data: ${JSON.stringify({
                    id: completionId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelId,
                    choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
                  })}\n\n`);
                }
              }

              // Emit tool calls delta
              safeEnqueue(`data: ${JSON.stringify({
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [
                  {
                    index: 0,
                    delta: { tool_calls: toolCalls },
                    finish_reason: null,
                  },
                ],
              })}\n\n`);

              // Final stop chunk with tool_calls finish reason
              safeEnqueue(`data: ${JSON.stringify({
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "tool_calls",
                  },
                ],
              })}\n\n`);
            } else {
              // No tool call, flush any unstreamed content
              if (responseToParse.length > streamedIndex) {
                const remaining = responseToParse.slice(streamedIndex);
                if (remaining) {
                  safeEnqueue(`data: ${JSON.stringify({
                    id: completionId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelId,
                    choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
                  })}\n\n`);
                }
              }

              // Final stop chunk
              safeEnqueue(`data: ${JSON.stringify({
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
              })}\n\n`);
            }

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
      const { cleanContent, toolCalls } = parseToolCallsFromResponse(fullResponse);

      const isToolCall = toolCalls.length > 0;
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
              content: isToolCall ? (cleanContent || null) : fullResponse,
              ...(isToolCall ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: isToolCall ? "tool_calls" : "stop",
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


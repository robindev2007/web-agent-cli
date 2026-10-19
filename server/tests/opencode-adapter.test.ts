import { describe, it, expect } from "bun:test";
import {
  formatMessagesForGemini,
  handleOpenCodeRequest,
  generateOpenCodeConfig,
  type ChatMessage,
} from "../src/adapters/opencode";
import { GeminiBrowserProvider } from "../src/providers";

describe("OpenCode Adapter — Message Formatting & Config", () => {
  it("formats multi-turn chat messages into Gemini DOM prompt", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are an expert fullstack developer." },
      { role: "user", content: "Create an express app" },
      { role: "assistant", content: "Sure, here is the package.json" },
      { role: "user", content: "Now add tests" },
    ];

    const result = formatMessagesForGemini(messages);

    expect(result).toContain("[SYSTEM INSTRUCTIONS]:");
    expect(result).toContain("You are an expert fullstack developer.");
    expect(result).toContain("[USER]:");
    expect(result).toContain("Create an express app");
    expect(result).toContain("[ASSISTANT]:");
    expect(result).toContain("Sure, here is the package.json");
    expect(result).toContain("Now add tests");
  });

  it("handles structured content array parts gracefully", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Part 1 of prompt" },
          { type: "text", text: "Part 2 of prompt" },
        ],
      },
    ];

    const result = formatMessagesForGemini(messages);
    expect(result).toContain("Part 1 of prompt");
    expect(result).toContain("Part 2 of prompt");
  });

  it("generates valid opencode.json schema configuration", () => {
    const config: any = generateOpenCodeConfig(3000);
    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.provider["web-agent"]).toBeDefined();
    expect(config.provider["web-agent"].options.baseURL).toBe("http://127.0.0.1:3000/v1");
    expect(config.provider["web-agent"].models["gemini-browser"]).toBeDefined();
  });
});

describe("OpenCode Adapter — HTTP API Protocol", () => {
  const provider = new GeminiBrowserProvider("test_opencode", "Test Provider");

  it("responds to OPTIONS preflight with CORS headers", async () => {
    const req = new Request("http://127.0.0.1:3000/v1/chat/completions", {
      method: "OPTIONS",
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(204);
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res?.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("lists models on GET /v1/models", async () => {
    const req = new Request("http://127.0.0.1:3000/v1/models", {
      method: "GET",
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = await res?.json();
    expect(data.object).toBe("list");
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.some((m: any) => m.id === "gemini-browser")).toBe(true);
  });

  it("returns 503 error with browser_disconnected when extension is not connected", async () => {
    const req = new Request("http://127.0.0.1:3000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-browser",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(503);

    const body = await res?.json();
    expect(body.error?.code).toBe("browser_disconnected");
  });

  it("returns 400 when empty messages are provided", async () => {
    // Mock provider as ready
    (provider as any).isReady = () => true;

    const req = new Request("http://127.0.0.1:3000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-browser",
        messages: [],
      }),
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.error?.code).toBe("empty_messages");
  });

  it("handles non-streaming chat completions when provider succeeds", async () => {
    // Mock provider
    (provider as any).isReady = () => true;
    (provider as any).sendPrompt = async () => "Hello from Gemini Web!";

    const req = new Request("http://127.0.0.1:3000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-browser",
        messages: [{ role: "user", content: "Say hello" }],
        stream: false,
      }),
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res?.status).toBe(200);

    const body = await res?.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello from Gemini Web!");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].finish_reason).toBe("stop");
  });

  it("handles streaming chat completions using Server-Sent Events (SSE)", async () => {
    (provider as any).isReady = () => true;
    (provider as any).sendPrompt = async (
      _prompt: string,
      _timeout: number,
      onStream?: (chunk: string) => void
    ) => {
      onStream?.("Hello ");
      onStream?.("world!");
      return "Hello world!";
    };

    const req = new Request("http://127.0.0.1:3000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-browser",
        messages: [{ role: "user", content: "Stream test" }],
        stream: true,
      }),
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Content-Type")).toContain("text/event-stream");

    const text = await res?.text();
    expect(text).toContain("data: ");
    expect(text).toContain("Hello ");
    expect(text).toContain("world!");
    expect(text).toContain("[DONE]");
  });

  it("handles streaming tool calls from Gemini and emits tool_calls chunks", async () => {
    (provider as any).isReady = () => true;
    (provider as any).sendPrompt = async () => {
      return (
        "I will create the Next.js project now.\n\n" +
        "[tool_call: bash for 'npx create-next-app@latest hellp-js --typescript' working_dir='D:/robin']"
      );
    };

    const req = new Request("http://127.0.0.1:3000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-browser",
        messages: [{ role: "user", content: "create a next js project" }],
        stream: true,
      }),
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res?.status).toBe(200);

    const text = await res?.text();
    expect(text).toContain("tool_calls");
    expect(text).toContain("bash");
    expect(text).toContain("npx -y create-next-app@latest hellp-js");
    expect(text).toContain("finish_reason\":\"tool_calls\"");
  });

  it("handles non-streaming tool calls and formats OpenAI tool_calls structure", async () => {
    (provider as any).isReady = () => true;
    (provider as any).sendPrompt = async () => {
      return (
        "Running the command:\n" +
        "```tool_call\n{\"name\": \"bash\", \"arguments\": {\"command\": \"dir\"}}\n```"
      );
    };

    const req = new Request("http://127.0.0.1:3000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-browser",
        messages: [{ role: "user", content: "list files" }],
        stream: false,
      }),
    });

    const res = await handleOpenCodeRequest(req, provider);
    expect(res?.status).toBe(200);

    const body = await res?.json();
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls).toBeDefined();
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("bash");
    expect(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments).command).toBe("dir");
  });
});


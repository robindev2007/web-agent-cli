import type { AIProvider } from "../providers";
import { LocalWorkspace, type ToolResult } from "../tools/workspace";
import { AGENT_SYSTEM_PROMPT } from "./prompt";

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  thought?: string;
}

export interface AgentCallbacks {
  onTurnStart?: (turn: number, maxTurns: number) => void;
  onGeminiThinking?: () => void;
  onGeminiStream?: (chunk: string, fullText: string) => void;
  onGeminiResponse?: (response: string) => void;
  onToolStart?: (call: ToolCall) => void;
  onToolStream?: (chunk: string, streamType: "stdout" | "stderr") => void;
  onToolComplete?: (call: ToolCall, result: ToolResult) => void;
  onTaskComplete?: (finalSummary: string) => void;
  onError?: (err: Error) => void;
  onStatusUpdate?: (status: string) => void;
}

export class AgentLoop {
  private provider: AIProvider;
  private workspace: LocalWorkspace;
  private maxTurns: number;

  constructor(provider: AIProvider, workspaceDir?: string, maxTurns: number = 10) {
    this.provider = provider;
    this.workspace = new LocalWorkspace(workspaceDir);
    this.maxTurns = maxTurns;
  }

  public getWorkspace(): LocalWorkspace {
    return this.workspace;
  }

  /**
   * Parse tool_call block or batch array of tool calls from Gemini response
   */
  public parseToolCalls(response: string): ToolCall[] {
    // 1. Try markdown fenced blocks first
    const codeBlockMatch = response.match(/```(?:tool_call|json|)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (Array.isArray(parsed)) {
          return parsed.filter((p) => p && typeof p.tool === "string");
        }
        if (parsed && typeof parsed.tool === "string") {
          return [parsed as ToolCall];
        }
      } catch {}
    }

    // 2. Look for JSON array or object
    const firstBrace = response.search(/[{\[]/);
    if (firstBrace !== -1) {
      const isArray = response[firstBrace] === "[";
      const openChar = isArray ? "[" : "{";
      const closeChar = isArray ? "]" : "}";

      let depth = 0;
      let inString = false;
      let escape = false;
      let endIndex = -1;

      for (let i = firstBrace; i < response.length; i++) {
        const char = response[i];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === "\\") {
          escape = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === openChar) depth++;
          else if (char === closeChar) {
            depth--;
            if (depth === 0) {
              endIndex = i;
              break;
            }
          }
        }
      }

      if (endIndex !== -1) {
        const candidate = response.slice(firstBrace, endIndex + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) {
            return parsed.filter((p) => p && typeof p.tool === "string");
          }
          if (parsed && typeof parsed.tool === "string") {
            return [parsed as ToolCall];
          }
        } catch {}
      }
    }

    return [];
  }

  /**
   * Backward compatibility single tool call parser
   */
  public parseToolCall(response: string): ToolCall | null {
    const list = this.parseToolCalls(response);
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Execute tool locally — dispatches to the cross-platform LocalWorkspace methods.
   * Supports Windows / macOS / Linux via auto-detected shell and fs-extra / fast-glob.
   */
  public async executeTool(call: ToolCall, callbacks?: AgentCallbacks): Promise<ToolResult> {
    switch (call.tool) {
      case "list_files":
        return await this.workspace.listFiles(call.args?.path || ".");

      case "read_file":
        return await this.workspace.readFile(call.args?.path);

      case "write_file":
        return await this.workspace.writeFile(call.args?.path, call.args?.content || "");

      case "copy_file":
        return await this.workspace.copyFile(call.args?.src, call.args?.dest, {
          overwrite: call.args?.overwrite ?? true,
        });

      case "move_file":
        return await this.workspace.moveFile(call.args?.src, call.args?.dest);

      case "delete_file":
        return await this.workspace.deleteFile(call.args?.path);

      case "ensure_dir":
        return await this.workspace.ensureDir(call.args?.path);

      case "glob":
        return await this.workspace.glob(call.args?.pattern, {
          ignore: call.args?.ignore,
          onlyFiles: call.args?.onlyFiles,
        });

      case "file_exists":
        return await this.workspace.fileExists(call.args?.path);

      case "run_command":
        return await this.workspace.runCommand(
          call.args?.command,
          call.args?.timeout ?? 60000,
          (chunk, type) => callbacks?.onToolStream?.(chunk, type)
        );

      default:
        return { success: false, error: `Unknown tool: ${call.tool}` };
    }
  }

  private initializedSession = false;

  /**
   * Run the continuous agent loop for a user task with batch parallel execution
   */
  public async runTask(userGoal: string, callbacks?: AgentCallbacks): Promise<string> {
    if ((this.provider as any).onTabReset !== undefined) {
      (this.provider as any).onTabReset = () => {
        this.initializedSession = false;
      };
    }

    let currentPrompt = this.initializedSession
      ? `USER TASK:\n${userGoal}`
      : `${AGENT_SYSTEM_PROMPT}\n\nUSER TASK:\n${userGoal}`;

    this.initializedSession = true;

    for (let turn = 1; turn <= this.maxTurns; turn++) {
      callbacks?.onTurnStart?.(turn, this.maxTurns);
      callbacks?.onGeminiThinking?.();

      // If a tab was reset by background recovery, ensure system prompt is included
      if (!this.initializedSession) {
        currentPrompt = `${AGENT_SYSTEM_PROMPT}\n\nUSER TASK:\n${userGoal}\n\n[CONTINUATION STATE]:\n${currentPrompt}`;
        this.initializedSession = true;
      }

      let geminiResponse: string;
      try {
        geminiResponse = await this.provider.sendPrompt(
          currentPrompt,
          45000,
          (chunk, fullText) => callbacks?.onGeminiStream?.(chunk, fullText)
        );
      } catch (err: any) {
        // If AI tab fails, freezes, or refuses new inputs, delete that tab immediately to free RAM, then retry!
        if (typeof (this.provider as any).resetTab === "function") {
          try {
            console.log("\n\x1b[33m[AgentLoop] AI tab unresponsive or input failed. Deleting dead tab to free RAM & resuming...\x1b[0m\n");
            if (typeof (this.provider as any).closeTab === "function") {
              await (this.provider as any).closeTab().catch(() => {});
            }
            await (this.provider as any).resetTab();
            this.initializedSession = true;
            const recoveryPrompt = `${AGENT_SYSTEM_PROMPT}\n\nUSER TASK:\n${userGoal}\n\n[RECOVERY FROM STUCK TAB]:\nThe previous browser tab was closed due to an error. Here is the current progress:\n${currentPrompt}\n\nResume execution immediately by calling tools.`;
            geminiResponse = await this.provider.sendPrompt(
              recoveryPrompt,
              25000,
              (chunk, fullText) => callbacks?.onGeminiStream?.(chunk, fullText)
            );
          } catch (retryErr: any) {
            callbacks?.onError?.(retryErr);
            throw retryErr;
          }
        } else {
          callbacks?.onError?.(err);
          throw err;
        }
      }

      callbacks?.onGeminiResponse?.(geminiResponse);

      const toolCalls = this.parseToolCalls(geminiResponse);

      if (toolCalls.length === 0) {
        callbacks?.onTaskComplete?.(geminiResponse);
        return geminiResponse;
      }

      // Execute batch tools sequentially or in parallel
      const batchResults: Array<{ tool: string; result: ToolResult }> = [];

      for (const call of toolCalls) {
        callbacks?.onToolStart?.(call);
        const result = await this.executeTool(call, callbacks);
        callbacks?.onToolComplete?.(call, result);
        batchResults.push({ tool: call.tool, result });
      }

      // Feed combined tool outputs back in 1 prompt (saving multiple turns)
      currentPrompt = `[TOOL_RESULTS (${batchResults.length} tools executed)]:\n${JSON.stringify(batchResults, null, 2)}\n\nWhat is your next step? If done, summarize what you accomplished.`;
    }

    const maxTurnsMsg = `Reached maximum turns (${this.maxTurns}).`;
    callbacks?.onTaskComplete?.(maxTurnsMsg);
    return maxTurnsMsg;
  }
}

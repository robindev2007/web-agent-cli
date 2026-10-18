import * as p from "@clack/prompts";
import pc from "picocolors";
import figures from "figures";
import type { ToolCall, AgentCallbacks } from "../agent/loop";
import type { ToolResult } from "../tools/workspace";
import { getToolIcon, renderTaskCompleteCard } from "./tui";

/**
 * Truncate long arrays of lines gracefully, preserving the head and tail.
 */
export function truncateLines(
  lines: string[],
  maxLines: number = 24,
  head: number = 10,
  tail: number = 10
): string[] {
  if (lines.length <= maxLines) return lines;
  const skipped = lines.length - head - tail;
  return [
    ...lines.slice(0, head),
    pc.dim(`   ... [${skipped} lines hidden] ...`),
    ...lines.slice(lines.length - tail),
  ];
}

/**
 * Real-time Stream Formatter that maintains Clack vertical bar tree alignment (│  )
 */
export class LiveStreamFormatter {
  private atLineStart = true;
  private hasPrinted = false;

  public write(chunk: string, colorFn: (s: string) => string = (s) => s): void {
    let output = "";
    for (const char of chunk) {
      if (this.atLineStart) {
        output += pc.dim("│  ");
        this.atLineStart = false;
        this.hasPrinted = true;
      }
      if (char === "\n") {
        output += "\n";
        this.atLineStart = true;
      } else {
        output += colorFn(char);
      }
    }
    process.stdout.write(output);
  }

  public end(): boolean {
    if (!this.atLineStart) {
      process.stdout.write("\n");
      this.atLineStart = true;
    }
    const hadOutput = this.hasPrinted;
    this.hasPrinted = false;
    return hadOutput;
  }

  public reset(): void {
    this.atLineStart = true;
    this.hasPrinted = false;
  }

  public hasOutput(): boolean {
    return this.hasPrinted;
  }
}

/**
 * Format tool output like OpenCode / Claude Code / modern agent CLIs
 */
export function formatToolOutput(call: ToolCall, res: ToolResult): string {
  if (!res.success) {
    const errMsg = res.error || (res.output && res.output.stderr) || "Unknown error";
    return pc.red(String(errMsg).trim());
  }

  // 1. run_command output
  if (call.tool === "run_command") {
    const out = res.output || {};
    const stdout = (typeof out === "string" ? out : out.stdout) || "";
    const stderr = out.stderr || "";
    const outputLines: string[] = [];

    if (stdout.trim()) {
      const rawLines = stdout.trim().split(/\r?\n/);
      outputLines.push(...truncateLines(rawLines));
    }

    if (stderr.trim()) {
      const errLines = stderr.trim().split(/\r?\n/);
      const coloredErr = truncateLines(errLines).map((l) => pc.yellow(l));
      outputLines.push(...coloredErr);
    }

    if (outputLines.length === 0) {
      return pc.dim("(no output)");
    }
    return outputLines.join("\n");
  }

  // 2. list_files output
  if (call.tool === "list_files") {
    if (Array.isArray(res.output)) {
      if (res.output.length === 0) return pc.dim("(empty directory)");
      const dirs = res.output
        .filter((i) => i.type === "directory")
        .sort((a, b) => a.name.localeCompare(b.name));
      const files = res.output
        .filter((i) => i.type !== "directory")
        .sort((a, b) => a.name.localeCompare(b.name));

      const all = [
        ...dirs.map((d) => pc.blue(`📁 ${d.name}/`)),
        ...files.map((f) => pc.dim(`📄 ${f.name}`)),
      ];

      if (all.length > 25) {
        return (
          all.slice(0, 20).join("\n") +
          "\n" +
          pc.dim(`   ... and ${all.length - 20} more items`)
        );
      }
      return all.join("\n");
    }
    return String(res.output || "");
  }

  // 3. read_file output
  if (call.tool === "read_file") {
    const content = typeof res.output === "string" ? res.output : "";
    if (!content.trim()) return pc.dim("(empty file)");

    const lines = content.split(/\r?\n/);
    const previewCount = Math.min(lines.length, 14);
    const preview = lines.slice(0, previewCount).map((l, i) => {
      const num = String(i + 1).padStart(3, " ");
      return pc.dim(`${num} │ `) + l;
    });

    if (lines.length > previewCount) {
      preview.push(pc.dim(`    ... (${lines.length - previewCount} more lines)`));
    }
    return preview.join("\n");
  }

  // 4. write_file output
  if (call.tool === "write_file") {
    const rawOut =
      typeof res.output === "string"
        ? res.output
        : `File written successfully: ${call.args?.path || ""}`;
    const content = call.args?.content;
    if (typeof content === "string" && content.trim()) {
      const lines = content.split(/\r?\n/);
      const previewCount = Math.min(lines.length, 6);
      const preview = lines.slice(0, previewCount).map((l, i) => {
        const num = String(i + 1).padStart(3, " ");
        return pc.dim(`${num} │ `) + pc.green(l);
      });
      if (lines.length > previewCount) {
        preview.push(pc.dim(`    ... (${lines.length - previewCount} more lines)`));
      }
      return `${pc.dim(rawOut)}\n${preview.join("\n")}`;
    }
    return pc.dim(rawOut);
  }

  // 5. copy_file output
  if (call.tool === "copy_file") {
    const msg = typeof res.output === "string" ? res.output : `Copied ${call.args?.src} → ${call.args?.dest}`;
    return pc.dim(`📋 ${msg}`);
  }

  // 6. move_file output
  if (call.tool === "move_file") {
    const msg = typeof res.output === "string" ? res.output : `Moved ${call.args?.src} → ${call.args?.dest}`;
    return pc.dim(`🔀 ${msg}`);
  }

  // 7. delete_file output
  if (call.tool === "delete_file") {
    const msg = typeof res.output === "string" ? res.output : `Deleted ${call.args?.path}`;
    return pc.dim(`🗑  ${msg}`);
  }

  // 8. ensure_dir output
  if (call.tool === "ensure_dir") {
    const msg = typeof res.output === "string" ? res.output : `Directory ready: ${call.args?.path}`;
    return pc.dim(`📁 ${msg}`);
  }

  // 9. glob output
  if (call.tool === "glob") {
    if (Array.isArray(res.output)) {
      if (res.output.length === 0) return pc.dim("(no matches)");
      const capped = res.output.slice(0, 20).map((f: string) => pc.dim(`  ${f}`));
      if (res.output.length > 20) capped.push(pc.dim(`  ... and ${res.output.length - 20} more`));
      return capped.join("\n");
    }
    return String(res.output || "");
  }

  // 10. file_exists output
  if (call.tool === "file_exists") {
    const exists = res.output as boolean;
    return exists ? pc.green(`✔ exists`) : pc.dim(`✖ not found`);
  }

  // Generic object or string fallback
  if (typeof res.output === "object" && res.output !== null) {
    return JSON.stringify(res.output, null, 2);
  }
  return String(res.output || "");
}

/**
 * Handle onToolStart logging with agent identification and tool arguments
 */
export function logToolStart(call: ToolCall, agentId?: string): void {
  const prefix = agentId ? pc.bold(pc.magenta(`[${agentId}]`)) + " " : "";
  const icon = getToolIcon(call.tool);
  p.log.info(`${prefix}${pc.cyan(icon)} ${pc.bold(call.tool)}`);

  if (call.thought) {
    p.log.message(pc.dim(`  ${figures.ellipsis} ${pc.italic(call.thought)}`));
  }

  if (call.tool === "run_command" && call.args?.command) {
    p.log.message(pc.bold(pc.white(`  $ ${call.args.command}`)));
  } else if (call.tool === "write_file" && call.args?.path) {
    const lines = call.args.content ? call.args.content.split(/\r?\n/).length : 0;
    p.log.message(
      pc.dim(`  ✎ ${call.args.path}`) + (lines > 0 ? pc.dim(` (${lines} lines)`) : "")
    );
  } else if (call.tool === "read_file" && call.args?.path) {
    p.log.message(pc.dim(`  📖 ${call.args.path}`));
  } else if (call.tool === "list_files") {
    p.log.message(pc.dim(`  ☷ ${call.args?.path || "."}`));
  } else if (call.tool === "glob" && call.args?.pattern) {
    const pat = Array.isArray(call.args.pattern) ? call.args.pattern.join(", ") : call.args.pattern;
    p.log.message(pc.dim(`  🔍 ${pat}`));
  } else if (call.tool === "copy_file" && call.args?.src) {
    p.log.message(pc.dim(`  📋 ${call.args.src} → ${call.args.dest}`));
  } else if (call.tool === "move_file" && call.args?.src) {
    p.log.message(pc.dim(`  ⇄ ${call.args.src} → ${call.args.dest}`));
  } else if (call.tool === "delete_file" && call.args?.path) {
    p.log.message(pc.dim(`  ✖ ${call.args.path}`));
  } else if (call.tool === "ensure_dir" && call.args?.path) {
    p.log.message(pc.dim(`  📁 ${call.args.path}`));
  } else if (call.tool === "file_exists" && call.args?.path) {
    p.log.message(pc.dim(`  ? ${call.args.path}`));
  } else if (call.args && Object.keys(call.args).length > 0) {
    p.log.message(pc.dim(`  ${JSON.stringify(call.args)}`));
  }
}

/**
 * Handle onToolComplete logging with full rendered output & status badge
 */
export function logToolComplete(
  call: ToolCall,
  res: ToolResult,
  agentId?: string
): void {
  const prefix = agentId ? `[${agentId}] ` : "";
  const formattedOutput = formatToolOutput(call, res);

  if (formattedOutput) {
    p.log.message(formattedOutput);
  }

  if (res.success) {
    let successDetail = "";
    if (call.tool === "run_command" && res.output?.exitCode !== undefined) {
      successDetail = pc.dim(` (exit ${res.output.exitCode})`);
    } else if (call.tool === "list_files" && Array.isArray(res.output)) {
      successDetail = pc.dim(` (${res.output.length} items)`);
    } else if (call.tool === "read_file" && typeof res.output === "string") {
      const lineCount = res.output.split(/\r?\n/).length;
      successDetail = pc.dim(` (${lineCount} lines)`);
    }

    p.log.message(pc.green(`✔ ${prefix}${call.tool} succeeded`) + successDetail);
  } else {
    const errSummary = res.error ? `: ${res.error}` : "";
    p.log.message(pc.red(`✖ ${prefix}${call.tool} failed${errSummary}`));
  }
}

export interface ReporterOptions {
  showTurn?: boolean;
  showSummary?: boolean;
}

// Patterns that indicate the AI is outputting a raw tool call JSON block (not prose)
const TOOL_JSON_PATTERNS = [
  /^\s*\[?\s*\{\s*"tool"\s*:/,
  /^\s*```(?:json|tool_call)?/,
  /^\s*\{\s*"thought"\s*:/,
];

function looksLikeToolJson(text: string): boolean {
  return TOOL_JSON_PATTERNS.some((re) => re.test(text.trimStart()));
}

/** Detect repetition loops: if the last 120 chars repeat 3+ times, the model is stuck */
function isRepetitionLoop(text: string): boolean {
  if (text.length < 360) return false;
  const tail = text.slice(-360);
  const chunk = tail.slice(-120);
  return tail.slice(0, -120).includes(chunk);
}

/**
 * Factory to create an AgentCallbacks handler with OpenCode-style output,
 * real-time streaming, JSON suppression, and loop detection.
 */
export function createAgentReporter(
  agentId?: string,
  options?: ReporterOptions
): AgentCallbacks {
  const toolStreamer = new LiveStreamFormatter();
  const aiStreamer = new LiveStreamFormatter();
  let streamedToolOutput = false;

  // AI stream state
  let aiFullText = "";
  let streamedAiReasoning = false;
  let inToolJsonBlock = false;
  let suppressedJsonNotice = false;
  let loopDetected = false;

  function resetAiStreamState() {
    aiFullText = "";
    inToolJsonBlock = false;
    suppressedJsonNotice = false;
    loopDetected = false;
    streamedAiReasoning = false;
    aiStreamer.reset();
  }

  return {
    onTurnStart(turn, maxTurns) {
      if (options?.showTurn) {
        p.log.step(pc.bold(pc.magenta(`[Step ${turn}/${maxTurns}] Agent Execution Turn`)));
      }
    },
    onGeminiThinking() {
      const prefix = agentId ? `[${agentId}] ` : "";
      p.log.info(pc.cyan(`${prefix}AI is planning next action...`));
      resetAiStreamState();
    },
    onGeminiStream(_chunk, fullText) {
      // Hard stop if loop detected
      if (loopDetected) return;

      if (isRepetitionLoop(fullText)) {
        loopDetected = true;
        aiStreamer.end();
        p.log.warn(
          pc.yellow("⚠ AI output loop detected — stopping stream display (tab recovery may trigger)")
        );
        return;
      }

      // Detect start of JSON tool call block — suppress raw output, show placeholder instead
      if (!inToolJsonBlock && looksLikeToolJson(fullText)) {
        inToolJsonBlock = true;
      }

      if (inToolJsonBlock) {
        if (!suppressedJsonNotice) {
          suppressedJsonNotice = true;
          if (streamedAiReasoning) {
            aiStreamer.end();
            streamedAiReasoning = false;
          }
          const prefix = agentId ? `[${agentId}] ` : "";
          p.log.message(pc.dim(`💡 ${prefix}Selecting tools to call...`));
        }
        aiFullText = fullText;
        return;
      }

      // Normal prose — emit only the *delta* (new chars since last chunk)
      const delta = fullText.slice(aiFullText.length);
      aiFullText = fullText;
      if (!delta) return;

      if (!streamedAiReasoning) {
        process.stdout.write(pc.dim("│") + "\n");
        streamedAiReasoning = true;
      }
      aiStreamer.write(delta, (s) => pc.dim(pc.italic(s)));
    },
    onGeminiResponse() {
      if (streamedAiReasoning) {
        aiStreamer.end();
        process.stdout.write(pc.dim("│") + "\n");
      }
      resetAiStreamState();
    },
    onToolStart(call) {
      streamedToolOutput = false;
      toolStreamer.reset();
      logToolStart(call, agentId);
      if (call.tool === "run_command") {
        process.stdout.write(pc.dim("│") + "\n");
      }
    },
    onToolStream(chunk, streamType) {
      streamedToolOutput = true;
      toolStreamer.write(chunk, (s) => (streamType === "stderr" ? pc.yellow(s) : s));
    },
    onToolComplete(call, res) {
      const hadStream = toolStreamer.end();
      if (hadStream) {
        process.stdout.write(pc.dim("│") + "\n");
      }

      const prefix = agentId ? `[${agentId}] ` : "";
      if (hadStream || streamedToolOutput) {
        if (res.success) {
          const exitCode =
            res.output?.exitCode !== undefined ? ` (exit ${res.output.exitCode})` : " (exit 0)";
          p.log.message(pc.green(`✔ ${prefix}${call.tool} succeeded`) + pc.dim(exitCode));
        } else {
          p.log.message(
            pc.red(`✖ ${prefix}${call.tool} failed: ${res.error || "Non-zero exit code"}`)
          );
        }
      } else {
        logToolComplete(call, res, agentId);
      }
    },
    onTaskComplete(summary) {
      if (options?.showSummary) {
        renderTaskCompleteCard("Mission Accomplished", summary);
      }
    },
    onError(err) {
      p.log.error(pc.red(`Error: ${err.message || String(err)}`));
    },
    onStatusUpdate(status) {
      p.log.step(pc.cyan(`⚡ ${status}`));
    },
  };
}


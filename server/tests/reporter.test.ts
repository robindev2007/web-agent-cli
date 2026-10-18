import { describe, it, expect } from "bun:test";
import { formatToolOutput, truncateLines } from "../src/cli/reporter";
import type { ToolCall } from "../src/agent/loop";
import type { ToolResult } from "../src/tools/workspace";

describe("CLI Reporter & Tool Output Formatter", () => {
  it("formats run_command stdout and stderr properly", () => {
    const call: ToolCall = {
      tool: "run_command",
      args: { command: "npm test" },
    };
    const res: ToolResult = {
      success: true,
      output: {
        exitCode: 0,
        stdout: "PASS src/index.test.ts\nTests: 5 passed",
        stderr: "warning: deprecated dependency",
      },
    };

    const formatted = formatToolOutput(call, res);
    expect(formatted).toContain("PASS src/index.test.ts");
    expect(formatted).toContain("warning: deprecated dependency");
  });

  it("truncates long outputs gracefully", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
    const truncated = truncateLines(lines, 20, 5, 5);
    expect(truncated.length).toBe(11);
    expect(truncated[0]).toBe("Line 1");
    expect(truncated[truncated.length - 1]).toBe("Line 50");
    expect(truncated.some((l) => l.includes("lines hidden"))).toBe(true);
  });

  it("formats list_files with directory and file icons", () => {
    const call: ToolCall = {
      tool: "list_files",
      args: { path: "." },
    };
    const res: ToolResult = {
      success: true,
      output: [
        { name: "src", type: "directory" },
        { name: "package.json", type: "file" },
        { name: "tsconfig.json", type: "file" },
      ],
    };

    const formatted = formatToolOutput(call, res);
    expect(formatted).toContain("src/");
    expect(formatted).toContain("package.json");
    expect(formatted).toContain("tsconfig.json");
  });

  it("formats read_file with line numbers and preview", () => {
    const call: ToolCall = {
      tool: "read_file",
      args: { path: "hello.ts" },
    };
    const res: ToolResult = {
      success: true,
      output: "const a = 1;\nconst b = 2;\nconsole.log(a + b);",
    };

    const formatted = formatToolOutput(call, res);
    expect(formatted).toContain("1 │");
    expect(formatted).toContain("const a = 1;");
  });

  it("formats write_file with confirmation and content preview", () => {
    const call: ToolCall = {
      tool: "write_file",
      args: { path: "src/db.ts", content: "export const db = 123;" },
    };
    const res: ToolResult = {
      success: true,
      output: "File written successfully: src/db.ts",
    };

    const formatted = formatToolOutput(call, res);
    expect(formatted).toContain("File written successfully: src/db.ts");
    expect(formatted).toContain("export const db = 123;");
  });

  it("handles failed tool execution with red error message", () => {
    const call: ToolCall = {
      tool: "run_command",
      args: { command: "non_existent_command" },
    };
    const res: ToolResult = {
      success: false,
      error: "Command not found",
    };

    const formatted = formatToolOutput(call, res);
    expect(formatted).toContain("Command not found");
  });

  it("LiveStreamFormatter writes lines and tracks real-time stream status", () => {
    const { LiveStreamFormatter } = require("../src/cli/reporter");
    const streamer = new LiveStreamFormatter();
    let captured = "";
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      captured += String(chunk);
      return true;
    }) as any;

    try {
      streamer.write("Streaming line 1\nStreaming line 2\n");
      const hadOutput = streamer.end();
      expect(hadOutput).toBe(true);
      expect(captured).toContain("Streaming line 1");
      expect(captured).toContain("Streaming line 2");
    } finally {
      process.stdout.write = origWrite;
    }
  });
});


import { describe, it, expect, beforeAll } from "@jest/globals";
import { LocalWorkspace } from "../src/tools/workspace";
import { AgentLoop } from "../src/agent/loop";
import type { AIProvider } from "../src/providers/types";
import { existsSync } from "node:fs";
import { readFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const SANDBOX_DIR = resolve(process.cwd(), "test_sandbox_advanced");

class AdvancedScenarioProvider implements AIProvider {
  public readonly name = "AdvancedScenarioProvider";
  public turn = 0;

  isReady(): boolean {
    return true;
  }

  async sendPrompt(prompt: string): Promise<string> {
    this.turn++;

    // Turn 1: Discover directory and create a full project
    if (this.turn === 1) {
      return JSON.stringify({
        thought: "Creating a TypeScript library with full unit tests and types.",
        tool: "write_file",
        args: {
          path: "src/string-utils.ts",
          content: `export function slugify(text: string): string {\n  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");\n}\n\nexport function truncate(text: string, max: number): string {\n  return text.length > max ? text.slice(0, max) + "..." : text;\n}`,
        },
      });
    }

    // Turn 2: Create unit test file
    if (this.turn === 2) {
      return JSON.stringify({
        thought: "Now writing unit tests for slugify and truncate.",
        tool: "write_file",
        args: {
          path: "tests/string-utils.test.ts",
          content: `import { slugify, truncate } from "../src/string-utils";\n\nif (slugify("Hello World & Universe!") !== "hello-world-universe") throw new Error("slugify failed");\nif (truncate("Long text string", 8) !== "Long tex...") throw new Error("truncate failed");\nconsole.log("STRING_UTILS_ALL_TESTS_PASSED");`,
        },
      });
    }

    // Turn 3: Execute tests with Bun
    if (this.turn === 3) {
      return JSON.stringify({
        thought: "Executing test suite to verify implementation.",
        tool: "run_command",
        args: { command: "bun run tests/string-utils.test.ts" },
      });
    }

    // Turn 4: Git initialization & commit in real sandbox
    if (this.turn === 4) {
      return JSON.stringify({
        thought: "Initialize git repository and make initial commit.",
        tool: "run_command",
        args: {
          command: "git init && git config user.name 'TestAgent' && git config user.email 'agent@test.com' && git add . && git commit -m 'Initial commit by Gemini Agent'",
        },
      });
    }

    // Turn 5: Complete
    return "The string-utils library has been built, tested with 100% pass rate, and committed to git!";
  }
}

describe("Advanced High-Level Autonomous Agent Workflow Tests", () => {
  let workspace: LocalWorkspace;

  beforeAll(async () => {
    if (existsSync(SANDBOX_DIR)) {
      await rm(SANDBOX_DIR, { recursive: true, force: true });
    }
    await mkdir(SANDBOX_DIR, { recursive: true });
    workspace = new LocalWorkspace(SANDBOX_DIR);
  });

  it("High-Level Test: Multi-file project creation, execution, and git workflow", async () => {
    const provider = new AdvancedScenarioProvider();
    const agent = new AgentLoop(provider, SANDBOX_DIR, 8);

    const executedTools: string[] = [];

    const finalSummary = await agent.runTask("Build string utility library with tests and git commit", {
      onToolStart(call) {
        executedTools.push(call.tool);
      },
    });

    // 1. Verify all 4 autonomous tools ran in order
    expect(executedTools).toEqual(["write_file", "write_file", "run_command", "run_command"]);

    // 2. Verify source code exists and is valid
    const srcPath = resolve(SANDBOX_DIR, "src/string-utils.ts");
    expect(existsSync(srcPath)).toBe(true);
    const src = await readFile(srcPath, "utf-8");
    expect(src).toContain("slugify");
    expect(src).toContain("truncate");

    // 3. Verify test file exists
    const testPath = resolve(SANDBOX_DIR, "tests/string-utils.test.ts");
    expect(existsSync(testPath)).toBe(true);

    // 4. Verify test runs cleanly
    const testRun = await workspace.runCommand("bun run tests/string-utils.test.ts");
    expect(testRun.success).toBe(true);
    expect(testRun.output.stdout).toContain("STRING_UTILS_ALL_TESTS_PASSED");

    // 5. Verify git repo was initialized on real disk
    const gitStatus = await workspace.runCommand("git status");
    expect(gitStatus.success).toBe(true);

    expect(finalSummary).toContain("string-utils library has been built");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { LocalWorkspace } from "../src/tools/workspace";
import { AgentLoop } from "../src/agent/loop";
import type { AIProvider } from "../src/providers/types";
import { existsSync } from "node:fs";
import { readFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const SANDBOX_DIR = resolve(process.cwd(), "test_sandbox");

/**
 * Real Multi-Step Autonomous Scenario Provider:
 * Simulates a realistic Gemini multi-turn coding session:
 * 1. Discover files in the workspace (list_files)
 * 2. Create package.json and index.ts (write_file)
 * 3. Run a build/test command via terminal (run_command)
 * 4. Read the file, identify a bug, and update/edit it (read_file + write_file)
 * 5. Re-run command to verify the fix passes (run_command)
 * 6. Conclude task
 */
class ScenarioCodingAIProvider implements AIProvider {
  public readonly name = "ScenarioCodingAIProvider";
  public step = 0;

  isReady(): boolean {
    return true;
  }

  async sendPrompt(prompt: string): Promise<string> {
    this.step++;

    // Step 1: Gemini decides to check the project files
    if (this.step === 1) {
      return JSON.stringify({
        thought: "First, let me inspect the directory to see what files exist.",
        tool: "list_files",
        args: { path: "." },
      });
    }

    // Step 2: Gemini writes a typescript file with a deliberate testable function
    if (this.step === 2) {
      return JSON.stringify({
        thought: "I will create a math module with an add and multiply function.",
        tool: "write_file",
        args: {
          path: "src/calculator.ts",
          content: `export function add(a: number, b: number): number { return a + b; }\nexport function multiply(a: number, b: number): number { return a * b; }`,
        },
      });
    }

    // Step 3: Gemini creates a runner script to test it
    if (this.step === 3) {
      return JSON.stringify({
        thought: "Now I create a runner test script to execute the calculations.",
        tool: "write_file",
        args: {
          path: "run_calc.ts",
          content: `import { add, multiply } from "./src/calculator";\nconst sum = add(10, 20);\nconst prod = multiply(5, 6);\nconsole.log(\`CALC_RESULT: sum=\${sum}, prod=\${prod}\`);`,
        },
      });
    }

    // Step 4: Gemini runs terminal command to execute the real script
    if (this.step === 4) {
      return JSON.stringify({
        thought: "I will now run the script using Bun to verify execution.",
        tool: "run_command",
        args: { command: "bun run run_calc.ts" },
      });
    }

    // Step 5: Gemini inspects the calculator and edits it (adds a new power function)
    if (this.step === 5) {
      return JSON.stringify({
        thought: "I will update calculator.ts to also export a power function.",
        tool: "write_file",
        args: {
          path: "src/calculator.ts",
          content: `export function add(a: number, b: number): number { return a + b; }\nexport function multiply(a: number, b: number): number { return a * b; }\nexport function power(a: number, b: number): number { return Math.pow(a, b); }`,
        },
      });
    }

    // Step 6: Gemini runs verification command
    if (this.step === 6) {
      return JSON.stringify({
        thought: "Verify the new power function via terminal eval.",
        tool: "run_command",
        args: { command: `bun -e "import { power } from './src/calculator'; console.log('POWER_RESULT: ' + power(2, 4));"` },
      });
    }

    // Step 7: Done
    return "All coding tasks, file creations, modifications, and terminal executions have been successfully verified!";
  }
}

describe("Real End-to-End (E2E) Coding Agent Tests in test_sandbox", () => {
  let workspace: LocalWorkspace;

  beforeAll(async () => {
    // Clean and initialize a clean test_sandbox directory on real disk
    if (existsSync(SANDBOX_DIR)) {
      await rm(SANDBOX_DIR, { recursive: true, force: true });
    }
    await mkdir(SANDBOX_DIR, { recursive: true });
    workspace = new LocalWorkspace(SANDBOX_DIR);
  });

  afterAll(async () => {
    // Keep or cleanup - we can leave it or inspect it
    // await rm(SANDBOX_DIR, { recursive: true, force: true });
  });

  // --- REAL DISK & SHELL TESTS ---

  it("E2E Test 1: Real Disk File Creation in sandbox", async () => {
    const res = await workspace.writeFile("config.json", JSON.stringify({ app: "agent-test", version: "1.0.0" }, null, 2));
    expect(res.success).toBe(true);

    const fullPath = resolve(SANDBOX_DIR, "config.json");
    expect(existsSync(fullPath)).toBe(true);

    const realContent = await readFile(fullPath, "utf-8");
    expect(JSON.parse(realContent).app).toBe("agent-test");
  });

  it("E2E Test 2: Real Disk File Read & Verification", async () => {
    const res = await workspace.readFile("config.json");
    expect(res.success).toBe(true);
    expect(typeof res.output).toBe("string");
    expect(res.output).toContain("agent-test");
  });

  it("E2E Test 3: Real File Modification / Editing on Disk", async () => {
    // Update existing file
    const updateRes = await workspace.writeFile("config.json", JSON.stringify({ app: "agent-test", version: "2.0.0", updated: true }, null, 2));
    expect(updateRes.success).toBe(true);

    const realContent = await readFile(resolve(SANDBOX_DIR, "config.json"), "utf-8");
    const parsed = JSON.parse(realContent);
    expect(parsed.version).toBe("2.0.0");
    expect(parsed.updated).toBe(true);
  });

  it("E2E Test 4: Real Nested Directory and File Creation", async () => {
    const res = await workspace.writeFile("modules/auth/service.ts", "export const login = () => true;");
    expect(res.success).toBe(true);

    const fullPath = resolve(SANDBOX_DIR, "modules/auth/service.ts");
    expect(existsSync(fullPath)).toBe(true);
  });

  it("E2E Test 5: Real Directory Listing reflects actual disk state", async () => {
    const res = await workspace.listFiles(".");
    expect(res.success).toBe(true);

    const fileNames = (res.output as Array<{ name: string; type: string }>).map((f) => f.name);
    expect(fileNames).toContain("config.json");
    expect(fileNames).toContain("modules");
  });

  it("E2E Test 6: Real Terminal Execution creates files via shell commands", async () => {
    // Run real shell command inside sandbox
    const res = await workspace.runCommand('echo Shell output OK> shell_created.txt');
    expect(res.success).toBe(true);

    const filePath = resolve(SANDBOX_DIR, "shell_created.txt");
    expect(existsSync(filePath)).toBe(true);
  });

  it("E2E Test 7: Real Terminal Execution captures stdout from code", async () => {
    const res = await workspace.runCommand("echo REAL_STDOUT_PAYLOAD_999");
    expect(res.success).toBe(true);
    expect(res.output.stdout).toContain("REAL_STDOUT_PAYLOAD_999");
    expect(res.output.exitCode).toBe(0);
  });

  it("E2E Test 8: Real Terminal Execution captures real errors and non-zero exits", async () => {
    const res = await workspace.runCommand("bun -e \"process.stderr.write('INTENTIONAL_TEST_CRASH'); process.exit(1)\"");
    expect(res.success).toBe(false);
    expect(res.output.stderr).toContain("INTENTIONAL_TEST_CRASH");
    expect(res.output.exitCode).not.toBe(0);
  });

  // --- FULL MULTI-STEP AUTONOMOUS AGENT WORKFLOW TEST ---

  it("E2E Test 9 & 10: Full Multi-Turn Autonomous Agent Workflow on Real Files", async () => {
    const provider = new ScenarioCodingAIProvider();
    const agent = new AgentLoop(provider, SANDBOX_DIR, 10);

    const finalResult = await agent.runTask("Build, test, and update calculator module in the project");

    // 1. Verify agent completed the mission
    expect(finalResult).toContain("successfully verified");

    // 2. Verify calculator.ts was physically created on disk
    const calcPath = resolve(SANDBOX_DIR, "src/calculator.ts");
    expect(existsSync(calcPath)).toBe(true);

    // 3. Verify modifications took effect on disk (power function exists)
    const calcContent = await readFile(calcPath, "utf-8");
    expect(calcContent).toContain("export function power");

    // 4. Verify runner script was created on disk
    const runnerPath = resolve(SANDBOX_DIR, "run_calc.ts");
    expect(existsSync(runnerPath)).toBe(true);

    // 5. Run the actual generated code from disk to confirm it runs 100% without errors
    const testExecution = await workspace.runCommand("bun run run_calc.ts");
    expect(testExecution.success).toBe(true);
    expect(testExecution.output.stdout).toContain("CALC_RESULT: sum=30, prod=30");
  });
});


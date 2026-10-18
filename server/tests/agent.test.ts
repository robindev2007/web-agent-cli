import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { LocalWorkspace } from "../src/tools/workspace";
import { AgentLoop } from "../src/agent/loop";
import type { AIProvider } from "../src/providers/types";
import { rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const TEST_DIR = resolve(process.cwd(), "test_sandbox");

// Mock AI Provider to benchmark agent loop and tool dispatch latency
class BenchmarkMockProvider implements AIProvider {
  public readonly name = "BenchmarkMockProvider";
  public calls: string[] = [];

  isReady(): boolean {
    return true;
  }

  async sendPrompt(prompt: string): Promise<string> {
    this.calls.push(prompt);
    // Simulate typical network latency of browser bridge (e.g. 5ms mock)
    await Bun.sleep(5);

    if (prompt.includes("USER TASK:\nCreate file")) {
      return JSON.stringify({
        thought: "Creating the requested file",
        tool: "write_file",
        args: { path: "benchmark_file.txt", content: "Performance test payload 12345" },
      });
    }

    if (prompt.includes("TOOL_RESULT")) {
      return "Task completed successfully. File created and verified.";
    }

    return "Done.";
  }
}

describe("Gemini Coding Agent - 10 Performance & Functionality Tests", () => {
  let workspace: LocalWorkspace;

  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    workspace = new LocalWorkspace(TEST_DIR);
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  // Test 1: File Creation Latency & Throughput
  it("1. write_file: creates file quickly and verifies disk write", async () => {
    const t0 = performance.now();
    const res = await workspace.writeFile("test1.txt", "Hello World 1");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    expect(elapsed).toBeLessThan(50); // < 50ms
    console.log(`  [Test 1] write_file execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 2: File Read Performance
  it("2. read_file: reads stored file accurately", async () => {
    const t0 = performance.now();
    const res = await workspace.readFile("test1.txt");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    expect(res.output).toBe("Hello World 1");
    console.log(`  [Test 2] read_file execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 3: Large File Handling (1MB payload)
  it("3. large_file: handles 1MB file write & read without slowdown", async () => {
    const largeContent = "A".repeat(1024 * 1024); // 1MB
    const t0 = performance.now();
    const writeRes = await workspace.writeFile("large.dat", largeContent);
    const readRes = await workspace.readFile("large.dat");
    const elapsed = performance.now() - t0;

    expect(writeRes.success).toBe(true);
    expect(readRes.output?.length).toBe(1024 * 1024);
    console.log(`  [Test 3] 1MB write + read execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 4: Directory Listing Speed
  it("4. list_files: scans directory items and classifications", async () => {
    const t0 = performance.now();
    const res = await workspace.listFiles(".");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    expect(Array.isArray(res.output)).toBe(true);
    expect(res.output.some((f: any) => f.name === "test1.txt")).toBe(true);
    console.log(`  [Test 4] list_files execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 5: Nested Directory Auto-Creation
  it("5. nested_dirs: recursively creates subdirectories on file write", async () => {
    const t0 = performance.now();
    const res = await workspace.writeFile("deep/nested/sub/folder/file.json", '{"ok":true}');
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    console.log(`  [Test 5] nested path write execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 6: Terminal Process Spawn Latency
  it("6. run_command: runs shell command and captures stdout/stderr", async () => {
    const t0 = performance.now();
    const res = await workspace.runCommand("echo agent_test_ok");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    expect(res.output.stdout).toContain("agent_test_ok");
    expect(res.output.exitCode).toBe(0);
    console.log(`  [Test 6] terminal command spawn execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 7: Terminal Error Capture & Exit Code Handling
  it("7. run_command_error: gracefully handles nonzero exit codes", async () => {
    const t0 = performance.now();
    const res = await workspace.runCommand("non_existent_command_12345");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(false);
    console.log(`  [Test 7] failed command error capture: ${elapsed.toFixed(2)} ms`);
  });

  // Test 8: Fuzzy Tool Parser - Markdown Block
  it("8. parseToolCall: parses ```tool_call ``` format accurately", () => {
    const loop = new AgentLoop(new BenchmarkMockProvider(), TEST_DIR);
    const raw = `Here is my thought\n\`\`\`tool_call\n{\n  "tool": "write_file",\n  "args": { "path": "abc.txt", "content": "123" }\n}\n\`\`\``;
    const t0 = performance.now();
    const parsed = loop.parseToolCall(raw);
    const elapsed = performance.now() - t0;

    expect(parsed).not.toBeNull();
    expect(parsed?.tool).toBe("write_file");
    expect(parsed?.args.path).toBe("abc.txt");
    console.log(`  [Test 8] parseToolCall (Markdown block): ${elapsed.toFixed(3)} ms`);
  });

  // Test 9: Fuzzy Tool Parser - Code snippet / Raw JSON
  it("9. parseToolCall: parses 'Code snippet' and raw JSON without backticks", () => {
    const loop = new AgentLoop(new BenchmarkMockProvider(), TEST_DIR);
    const raw = `Code snippet\n{\n  "thought": "Writing file",\n  "tool": "list_files",\n  "args": { "path": "." }\n}`;
    const t0 = performance.now();
    const parsed = loop.parseToolCall(raw);
    const elapsed = performance.now() - t0;

    expect(parsed).not.toBeNull();
    expect(parsed?.tool).toBe("list_files");
    console.log(`  [Test 9] parseToolCall (Raw JSON / Code snippet): ${elapsed.toFixed(3)} ms`);
  });

  // Test 10: Full Autonomous Multi-turn Agent Loop Execution
  it("10. AgentLoop: completes full end-to-end task cycle autonomously", async () => {
    const provider = new BenchmarkMockProvider();
    const loop = new AgentLoop(provider, TEST_DIR);

    const t0 = performance.now();
    const finalResponse = await loop.runTask("Create file benchmark_file.txt");
    const elapsed = performance.now() - t0;

    expect(finalResponse).toContain("Task completed");

    // Verify file was actually written to disk by the autonomous loop
    const checkFile = await workspace.readFile("benchmark_file.txt");
    expect(checkFile.success).toBe(true);
    expect(checkFile.output).toBe("Performance test payload 12345");

    console.log(`  [Test 10] Full autonomous loop execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 11: Auto-Recovery on Stuck Tab / Input Failure
  it("11. AgentLoop: automatically resets tab and recovers session when AI tab fails", async () => {
    class FailingThenRecoveringProvider implements AIProvider {
      public name = "FailingThenRecoveringProvider";
      public attempts = 0;
      public resetTabCalled = false;
      public onTabReset?: () => void;

      isReady() {
        return true;
      }

      async resetTab() {
        this.resetTabCalled = true;
        this.onTabReset?.();
      }

      async sendPrompt(prompt: string) {
        this.attempts++;
        if (this.attempts === 1) {
          throw new Error("AI tab unresponsive or rejected input");
        }
        return JSON.stringify({
          tool: "write_file",
          args: { path: "recovered.txt", content: "Recovered successfully!" },
        });
      }
    }

    const provider = new FailingThenRecoveringProvider();
    const loop = new AgentLoop(provider, TEST_DIR, 2);
    await loop.runTask("Test recovery");

    expect(provider.resetTabCalled).toBe(true);
    expect(provider.attempts).toBeGreaterThanOrEqual(2);
    const checkFile = await workspace.readFile("recovered.txt");
    expect(checkFile.success).toBe(true);
    expect(checkFile.output).toBe("Recovered successfully!");
    console.log(`  [Test 11] Auto tab recovery verified on stuck tab failure`);
  });

  // Test 12: copy_file — copies a file cross-platform
  it("12. copy_file: copies a file to a new location", async () => {
    await workspace.writeFile("source.txt", "copy source content");
    const t0 = performance.now();
    const res = await workspace.copyFile("source.txt", "copied.txt");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    const verify = await workspace.readFile("copied.txt");
    expect(verify.output).toBe("copy source content");
    console.log(`  [Test 12] copy_file execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 13: move_file — rename / move cross-platform
  it("13. move_file: moves (renames) a file cross-platform", async () => {
    await workspace.writeFile("before_move.txt", "move me");
    const t0 = performance.now();
    const res = await workspace.moveFile("before_move.txt", "after_move.txt");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    const notThere = await workspace.readFile("before_move.txt");
    expect(notThere.success).toBe(false); // original gone
    const isThere = await workspace.readFile("after_move.txt");
    expect(isThere.output).toBe("move me");
    console.log(`  [Test 13] move_file execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 14: delete_file — rm -rf equivalent
  it("14. delete_file: removes file (rm -rf, no error if missing)", async () => {
    await workspace.writeFile("to_delete.txt", "bye");
    const t0 = performance.now();
    const res = await workspace.deleteFile("to_delete.txt");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    const gone = await workspace.readFile("to_delete.txt");
    expect(gone.success).toBe(false);
    // Deleting non-existent path should also succeed (no throw)
    const again = await workspace.deleteFile("to_delete.txt");
    expect(again.success).toBe(true);
    console.log(`  [Test 14] delete_file execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 15: ensure_dir — mkdir -p equivalent
  it("15. ensure_dir: creates nested directory tree (mkdir -p)", async () => {
    const t0 = performance.now();
    const res = await workspace.ensureDir("ensure/a/b/c");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    // Write into the created dir to confirm it exists
    const write = await workspace.writeFile("ensure/a/b/c/ok.txt", "yes");
    expect(write.success).toBe(true);
    console.log(`  [Test 15] ensure_dir execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 16: glob — cross-platform pattern search
  it("16. glob: finds files matching a pattern (cross-platform backslash-safe)", async () => {
    await workspace.writeFile("glob_test/a.ts", "");
    await workspace.writeFile("glob_test/b.ts", "");
    await workspace.writeFile("glob_test/c.json", "{}");

    const t0 = performance.now();
    const res = await workspace.glob("glob_test/**/*.ts");
    const elapsed = performance.now() - t0;

    expect(res.success).toBe(true);
    expect(Array.isArray(res.output)).toBe(true);
    expect(res.output.length).toBe(2);
    expect(res.output.every((f: string) => f.endsWith(".ts"))).toBe(true);
    console.log(`  [Test 16] glob execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 17: file_exists — existence check without throwing
  it("17. file_exists: correctly reports file presence and absence", async () => {
    await workspace.writeFile("i_exist.txt", "yes");

    const t0 = performance.now();
    const exists = await workspace.fileExists("i_exist.txt");
    const missing = await workspace.fileExists("i_do_not_exist.txt");
    const elapsed = performance.now() - t0;

    expect(exists.success).toBe(true);
    expect(exists.output).toBe(true);
    expect(missing.success).toBe(true);
    expect(missing.output).toBe(false);
    console.log(`  [Test 17] file_exists execution: ${elapsed.toFixed(2)} ms`);
  });

  // Test 18: Concurrent File Writes with Race-Free Locking
  it("18. concurrent writes: safely serializes multiple agents writing to the same file", async () => {
    const concurrentWrites = 15;
    const promises: Promise<any>[] = [];

    // 15 simultaneous writes launched at the exact same moment
    for (let i = 0; i < concurrentWrites; i++) {
      promises.push(workspace.writeFile("shared_concurrent.txt", `Payload from agent #${i}`));
    }

    const results = await Promise.all(promises);
    expect(results.every((r) => r.success)).toBe(true);

    const finalRead = await workspace.readFile("shared_concurrent.txt");
    expect(finalRead.success).toBe(true);
    expect(finalRead.output).toContain("Payload from agent #");
    console.log(`  [Test 18] Concurrent writes: 15 simultaneous writes safely serialized`);
  });
});



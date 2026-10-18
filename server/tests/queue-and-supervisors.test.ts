import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TaskQueue } from "../src/agent/queue";
import { DualSupervisor, FallbackController } from "../src/agent/supervisor";
import { LocalWorkspace } from "../src/tools/workspace";
import { MultiAgentOrchestrator } from "../src/agent/orchestrator";

const TEST_DIR = resolve(process.cwd(), "test_sandbox_queue");

describe("TaskQueue Engine & State Persistence", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("adds tasks with pending state and default maxRetries", () => {
    const queue = new TaskQueue(TEST_DIR);
    const task = queue.addTask("Build auth service", "Setup JWT auth");

    expect(task.id).toBeDefined();
    expect(task.title).toBe("Build auth service");
    expect(task.status).toBe("pending");
    expect(task.retries).toBe(0);
    expect(task.maxRetries).toBe(2);

    const stats = queue.getStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(0);
  });

  it("claims tasks sequentially and updates status to running", () => {
    const queue = new TaskQueue(TEST_DIR);
    queue.addTask("Task 1");
    queue.addTask("Task 2");

    const claimed1 = queue.claimNextTask("worker_1");
    expect(claimed1).not.toBeNull();
    expect(claimed1?.title).toBe("Task 1");
    expect(claimed1?.status).toBe("running");
    expect(claimed1?.assignedAgentId).toBe("worker_1");

    const claimed2 = queue.claimNextTask("worker_2");
    expect(claimed2?.title).toBe("Task 2");
    expect(claimed2?.assignedAgentId).toBe("worker_2");

    const stats = queue.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.running).toBe(2);
  });

  it("completes tasks and preserves output results", () => {
    const queue = new TaskQueue(TEST_DIR);
    const task = queue.addTask("Task to complete");
    queue.claimNextTask("worker_1");

    const completed = queue.completeTask(task.id, "Generated 2 auth routes");
    expect(completed).toBe(true);

    const updated = queue.getTask(task.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.result).toBe("Generated 2 auth routes");
    expect(updated?.error).toBeNull();
  });

  it("retries failed tasks up to maxRetries then marks as failed", () => {
    const queue = new TaskQueue(TEST_DIR);
    const task = queue.addTask("Flaky task", "", 2); // max 2 retries
    queue.claimNextTask("worker_1");

    // Failure #1 -> Should retry
    const res1 = queue.failTask(task.id, "Timeout 1");
    expect(res1.willRetry).toBe(true);
    expect(res1.task?.status).toBe("pending");
    expect(res1.task?.retries).toBe(1);

    // Re-claim and Failure #2 -> Should retry
    queue.claimNextTask("worker_2");
    const res2 = queue.failTask(task.id, "Timeout 2");
    expect(res2.willRetry).toBe(true);
    expect(res2.task?.retries).toBe(2);

    // Re-claim and Failure #3 -> Exhausted retries -> marks failed
    queue.claimNextTask("worker_3");
    const res3 = queue.failTask(task.id, "Timeout 3");
    expect(res3.willRetry).toBe(false);
    expect(res3.task?.status).toBe("failed");

    const stats = queue.getStats();
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it("persists queue state across instances via disk snapshot", () => {
    const queue1 = new TaskQueue(TEST_DIR);
    const task = queue1.addTask("Persistent task", "Details");
    queue1.claimNextTask("worker_persist");
    queue1.completeTask(task.id, "Completed successfully");

    // Instantiate fresh TaskQueue pointing to same directory
    const queue2 = new TaskQueue(TEST_DIR);
    const loadedTask = queue2.getTask(task.id);
    expect(loadedTask).toBeDefined();
    expect(loadedTask?.title).toBe("Persistent task");
    expect(loadedTask?.status).toBe("completed");
    expect(loadedTask?.result).toBe("Completed successfully");
  });
});

describe("Dual Supervisors & Fallback Controller", () => {
  let workspace: LocalWorkspace;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    workspace = new LocalWorkspace(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("detects false success / hallucinations when claimed files do not exist", async () => {
    const fallback = new FallbackController(workspace);
    const workerOutput = "I have successfully created auth/token.ts and configured routes.";

    const verdict = await fallback.verifyTaskLocally("Setup auth tokens", workerOutput);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("False success detected");
    expect(verdict.reason).toContain("auth/token.ts");
  });

  it("approves genuine work when referenced files actually exist on disk", async () => {
    const fallback = new FallbackController(workspace);
    // Actually create the file on disk
    writeFileSync(resolve(TEST_DIR, "token.ts"), "export const token = 'abc';", "utf-8");

    const workerOutput = "I have written token.ts and verified the exports work properly.";
    const verdict = await fallback.verifyTaskLocally("Create token file", workerOutput);
    expect(verdict.passed).toBe(true);
    expect(verdict.supervisor).toBe("fallback");
  });

  it("detects explicit worker error reports", async () => {
    const fallback = new FallbackController(workspace);
    const workerOutput = "Error: Failed to compile module. Types were missing.";

    const verdict = await fallback.verifyTaskLocally("Compile app", workerOutput);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("Worker reported errors");
  });

  it("DualSupervisor falls back gracefully when AI tabs are not connected", async () => {
    const dualSupervisor = new DualSupervisor(workspace);
    writeFileSync(resolve(TEST_DIR, "index.ts"), "console.log('hi');", "utf-8");

    const report = await dualSupervisor.reviewWorkerTask(
      "Create index.ts",
      "Write index entrypoint",
      "I created index.ts successfully.",
      500 // fast timeout for test
    );

    expect(report.fallbackUsed).toBe(true);
    expect(report.allPassed).toBe(true);
    expect(report.supervisorA.passed).toBe(true);
    expect(report.supervisorB.passed).toBe(true);
  });
});

describe("MultiAgentOrchestrator Architecture & Session Isolation", () => {
  it("enforces session isolation by assigning unique agent IDs per worker", () => {
    const orchestrator = new MultiAgentOrchestrator(TEST_DIR);
    const w1 = orchestrator.createSubAgent("Coder");
    const w2 = orchestrator.createSubAgent("Tester");

    expect(w1.id).not.toBe(w2.id);
    expect(w1.id).toContain("worker_");
    expect(w2.id).toContain("worker_");
  });

  it("updates dashboard state correctly during orchestration cycle", () => {
    const orchestrator = new MultiAgentOrchestrator(TEST_DIR);
    let capturedState: any = null;
    orchestrator.onDashboardUpdate((state) => {
      capturedState = state;
    });

    orchestrator.setMotherObjective("Build Microservice", "Split into 3 sub-tasks");

    const state = orchestrator.getDashboardState();
    expect(state.motherObjective).toBe("Build Microservice");
    expect(state.motherDecision).toBe("Split into 3 sub-tasks");
    expect(state.supervisorHealth.fallbackReady).toBe(true);
    expect(capturedState).not.toBeNull();
  });
});


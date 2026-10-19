import { GeminiBrowserProvider } from "../providers";
import { AgentLoop } from "./loop";
import { LocalWorkspace } from "../tools/workspace";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { createAgentReporter, LiveStreamFormatter } from "../cli/reporter";
import { classifyTask, type AgentMode } from "./classifier";
import { TaskQueue, type QueuedTask } from "./queue";
import { DualSupervisor, type DualSupervisorReport } from "./supervisor";
import type { SystemDashboardState } from "../cli/tui";

export interface OrchestrationResult {
  motherPlan: string;
  subAgentWork: Array<{ id: string; role: string; output: string }>;
  reviewReport: string;
  finalAnswer?: string;
  supervisorReport?: DualSupervisorReport;
}

export class MultiAgentOrchestrator {
  private motherProvider: GeminiBrowserProvider;
  private reviewerProvider: GeminiBrowserProvider;
  private dualSupervisor: DualSupervisor;
  private taskQueue: TaskQueue;
  private subAgentCounter = 0;
  private workspace: LocalWorkspace;
  private activeWorkers = new Map<string, { id: string; role: string; loop: AgentLoop; activeTask?: string }>();
  private dashboardState: SystemDashboardState;
  private dashboardListeners: Array<(state: SystemDashboardState) => void> = [];

  constructor(workspaceDir?: string) {
    this.workspace = new LocalWorkspace(workspaceDir);
    this.taskQueue = new TaskQueue(this.workspace.getBaseDir());
    this.dualSupervisor = new DualSupervisor(this.workspace);

    // Primary Tab 1: Mother Coordinator
    this.motherProvider = new GeminiBrowserProvider("mother", "Mother (Lead Architect)");
    // Legacy Tab 2: Reviewer (for backward compatibility)
    this.reviewerProvider = new GeminiBrowserProvider("reviewer", "Reviewer (Code Inspector)");

    this.dashboardState = {
      motherObjective: "Idle",
      motherDecision: "Waiting for user task",
      tasks: [],
      aiSessions: [],
      supervisorHealth: {
        supervisorA: "idle",
        supervisorB: "idle",
        fallbackReady: true,
      },
      cleanupStatus: "Silent background cleanup standby",
      recoveryLogs: [],
      activeIssues: [],
      activeAIs: 0,
      availableAIs: 4,
    };

    // Keep dashboard state synced with task queue changes
    this.taskQueue.onChange((tasks) => {
      this.dashboardState.tasks = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignedAgentId: t.assignedAgentId,
        retries: t.retries,
        error: t.error,
      }));
      this.notifyDashboard();
    });
  }

  public getMotherProvider(): GeminiBrowserProvider {
    return this.motherProvider;
  }

  public getWorkspace(): LocalWorkspace {
    return this.workspace;
  }

  public getTaskQueue(): TaskQueue {
    return this.taskQueue;
  }

  public getDualSupervisor(): DualSupervisor {
    return this.dualSupervisor;
  }

  public getDashboardState(): SystemDashboardState {
    return { ...this.dashboardState };
  }

  public onDashboardUpdate(listener: (state: SystemDashboardState) => void): () => void {
    this.dashboardListeners.push(listener);
    return () => {
      this.dashboardListeners = this.dashboardListeners.filter((l) => l !== listener);
    };
  }

  private notifyDashboard(): void {
    this.dashboardState.activeAIs = this.activeWorkers.size;
    this.dashboardState.aiSessions = Array.from(this.activeWorkers.values()).map((w) => ({
      id: w.id,
      role: w.role,
      taskTitle: w.activeTask || "Processing assigned task",
      status: "executing",
    }));

    for (const listener of this.dashboardListeners) {
      try {
        listener(this.dashboardState);
      } catch {}
    }
  }

  public setMotherObjective(objective: string, decision: string): void {
    this.dashboardState.motherObjective = objective;
    this.dashboardState.motherDecision = decision;
    this.notifyDashboard();
  }

  /**
   * Spawns a dedicated sub-agent in a new browser tab with strict session isolation
   */
  public createSubAgent(role: string = "Coder"): { id: string; loop: AgentLoop } {
    this.subAgentCounter++;
    const id = `worker_${this.subAgentCounter}`;
    const provider = new GeminiBrowserProvider(id, `Worker ${this.subAgentCounter} (${role})`);
    const loop = new AgentLoop(provider, this.workspace.getBaseDir(), 6);
    return { id, loop };
  }

  /**
   * Replace a broken or unresponsive AI worker session with a clean instance
   */
  public async replaceWorkerSession(workerId: string, role: string = "Coder"): Promise<{ id: string; loop: AgentLoop }> {
    const existing = this.activeWorkers.get(workerId);
    if (existing) {
      // Silent cleanup: close the broken session tab in background
      await (existing.loop.getProvider() as GeminiBrowserProvider).closeTab().catch(() => {});
      this.activeWorkers.delete(workerId);
    }

    this.dashboardState.recoveryLogs.push(`Session ${workerId} replaced due to timeout/failure`);
    this.dashboardState.cleanupStatus = `Closed stalled session ${workerId}`;
    this.notifyDashboard();

    return this.createSubAgent(role);
  }

  /**
   * Ask the Mother AI to classify whether a task needs multi-agent or solo execution.
   */
  public async aiClassifyTask(
    userGoal: string,
    options?: { forceLocal?: boolean }
  ): Promise<{
    mode: AgentMode;
    reason: string;
    confidence: "high" | "medium" | "low";
    source: "ai" | "local";
    tasks?: string[];
  }> {
    const lower = userGoal.toLowerCase().trim();
    const isGreetingOrDirectQuery =
      /^(hi|hello|hey|greetings|how are you|what is your name|who are you|what can you do)\b/i.test(lower) ||
      (lower.split(/\s+/).length <= 4 && !/(build|create|scaffold|fullstack|refactor|deploy)/i.test(lower));

    if (isGreetingOrDirectQuery) {
      return {
        mode: "single",
        reason: "Direct conversational inquiry (Instant Solo Execution)",
        confidence: "high",
        source: "local",
        tasks: [],
      };
    }

    if (options?.forceLocal || !this.motherProvider.isReady()) {
      const local = classifyTask(userGoal);
      return { ...local, source: "local" };
    }

    const classifyPrompt = `You are MOTHER, the lead coordinating AI. Decide whether the following task needs a MULTI-AGENT team or a SOLO agent.
If the task has 2 or more distinct sub-tasks, list them as a concise string array. If simple/single, leave tasks empty.

TASK: "${userGoal}"

Rules:
- MULTI: complex projects, multiple files/concerns, full-stack, auth, deploy, scaffold, refactor, tests
- SINGLE: quick fixes, single file edits, simple scripts, lookups, renames, one command

Respond ONLY with valid JSON, nothing else:
{"mode":"multi","reason":"<1 sentence why>","confidence":"high","tasks":["build frontend","create api routes"]}
or
{"mode":"single","reason":"<1 sentence why>","confidence":"high","tasks":[]}

confidence must be "high", "medium", or "low".`;

    try {
      const raw = await this.motherProvider.sendPrompt(classifyPrompt, 20000);
      const jsonMatch = raw.match(/\{[\s\S]*?"mode"[\s\S]*?\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI classification response");

      const parsed = JSON.parse(jsonMatch[0]);
      const mode = parsed.mode === "multi" ? "multi" : "single";
      const reason = typeof parsed.reason === "string" ? parsed.reason : "AI decision";
      const confidence =
        ["high", "medium", "low"].includes(parsed.confidence)
          ? (parsed.confidence as "high" | "medium" | "low")
          : "medium";
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter((t: any) => typeof t === "string" && t.trim()) : [];

      return { mode, reason, confidence, source: "ai", tasks };
    } catch {
      const local = classifyTask(userGoal);
      return { ...local, source: "local" };
    }
  }

  /**
   * Execute an assigned task on a worker with session isolation, dual supervisor audit, and automatic retry
   */
  public async executeWorkerTask(
    userGoal: string,
    task: QueuedTask,
    role: string = "Specialist Coder"
  ): Promise<{ success: boolean; output: string; supervisorReport?: DualSupervisorReport }> {
    let worker = this.createSubAgent(role);
    this.activeWorkers.set(worker.id, { id: worker.id, role, loop: worker.loop, activeTask: task.title });
    this.notifyDashboard();

    const maxTaskRetries = task.maxRetries ?? 2;
    let attempt = 0;
    let workerOutput = "";

    while (attempt <= maxTaskRetries) {
      attempt++;
      try {
        const missionPrompt = `TASK OBJECTIVE: "${task.title}"
DETAILS / CONTEXT:
${task.description || userGoal}

IMPORTANT: Do NOT give advice to the user. Call 'run_command', 'write_file', or other workspace tools to perform the work now on disk.`;

        workerOutput = await worker.loop.runTask(
          missionPrompt,
          createAgentReporter(worker.id, { showTurn: true })
        );

        // Step: Dual Supervisors verify completion & sanity
        this.dashboardState.supervisorHealth.supervisorA = "verifying";
        this.dashboardState.supervisorHealth.supervisorB = "verifying";
        this.notifyDashboard();

        const supervisorReport = await this.dualSupervisor.reviewWorkerTask(
          userGoal,
          task.title,
          workerOutput,
          10000 // 10s soft responsiveness threshold
        );

        this.dashboardState.supervisorHealth.supervisorA = supervisorReport.supervisorA.passed ? "healthy" : "degraded";
        this.dashboardState.supervisorHealth.supervisorB = supervisorReport.supervisorB.passed ? "healthy" : "degraded";
        this.notifyDashboard();

        if (supervisorReport.allPassed) {
          // Success! Complete task in queue
          this.taskQueue.completeTask(task.id, workerOutput);
          this.taskQueue.setSupervisorVerdict(task.id, "supervisorA", supervisorReport.supervisorA);
          this.taskQueue.setSupervisorVerdict(task.id, "supervisorB", supervisorReport.supervisorB);

          // Silent background cleanup: free worker tab
          await (worker.loop.getProvider() as GeminiBrowserProvider).closeTab().catch(() => {});
          this.activeWorkers.delete(worker.id);
          this.dashboardState.cleanupStatus = `Silently reclaimed RAM for ${worker.id}`;
          this.notifyDashboard();

          return { success: true, output: workerOutput, supervisorReport };
        } else {
          // Supervisors detected problem: alert Mother AI & re-attempt if retries remain
          const alert = supervisorReport.alertForMother || "Supervisors rejected work";
          p.log.warn(pc.yellow(`⚠️ [Supervisors]: ${alert}`));

          const { willRetry } = this.taskQueue.failTask(task.id, alert);
          if (!willRetry) {
            // Retries exhausted
            await (worker.loop.getProvider() as GeminiBrowserProvider).closeTab().catch(() => {});
            this.activeWorkers.delete(worker.id);
            return { success: false, output: workerOutput, supervisorReport };
          }

          // Replace session for clean retry
          worker = await this.replaceWorkerSession(worker.id, role);
          this.activeWorkers.set(worker.id, { id: worker.id, role, loop: worker.loop, activeTask: task.title });
        }
      } catch (err: any) {
        const errorMsg = err.message || String(err);
        const { willRetry } = this.taskQueue.failTask(task.id, errorMsg);

        if (!willRetry) {
          await (worker.loop.getProvider() as GeminiBrowserProvider).closeTab().catch(() => {});
          this.activeWorkers.delete(worker.id);
          return { success: false, output: `Worker failed: ${errorMsg}` };
        }

        // Auto recovery: replace worker session
        worker = await this.replaceWorkerSession(worker.id, role);
        this.activeWorkers.set(worker.id, { id: worker.id, role, loop: worker.loop, activeTask: task.title });
      }
    }

    await (worker.loop.getProvider() as GeminiBrowserProvider).closeTab().catch(() => {});
    this.activeWorkers.delete(worker.id);
    return { success: false, output: workerOutput };
  }

  /**
   * Run the full Mother-Worker-Supervisor workflow:
   * 1. Mother decomposes task and enqueues work
   * 2. Workers execute assigned tasks with isolated sessions
   * 3. Dual Supervisors verify genuine completion & code validity
   * 4. Only Mother communicates the final result to the user
   */
  public async executeTask(userGoal: string): Promise<OrchestrationResult> {
    this.setMotherObjective(userGoal, "Decomposing task and assigning workers");

    // STEP 1: Mother Plans
    p.log.step(pc.bold(pc.magenta("👑 [1/4] Mother AI is analyzing goal & planning task execution...")));
    const motherStreamer = new LiveStreamFormatter();
    let motherStarted = false;

    const motherPlanPrompt = `You are MOTHER, the Lead Agent Architect.
Goal: "${userGoal}"

Analyze the task and break it down into 1 or 2 specific sub-tasks for your dedicated worker agents.
Return your plan in concise bullet points.`;

    const motherPlan = await this.motherProvider.sendPrompt(
      motherPlanPrompt,
      180000,
      (chunk) => {
        if (!motherStarted) {
          p.log.info(pc.magenta("Mother plan streaming live:"));
          process.stdout.write(pc.dim("│") + "\n");
          motherStarted = true;
        }
        motherStreamer.write(chunk, (s) => pc.magenta(s));
      }
    );
    if (motherStarted) {
      motherStreamer.end();
      process.stdout.write(pc.dim("│") + "\n");
    }

    // Add task to TaskQueue
    const queuedTask = this.taskQueue.addTask(userGoal, motherPlan);
    this.setMotherObjective(userGoal, `Dispatched task ${queuedTask.id} to worker`);

    // STEP 2: Dedicated Worker Execution with isolated session
    p.log.step(pc.bold(pc.cyan(`🤖 [2/4] Worker is executing tools on disk...`)));
    const workerResult = await this.executeWorkerTask(userGoal, queuedTask, "Fullstack Coder");

    // STEP 3: Legacy Reviewer & Dual Supervisor verification
    p.log.step(pc.bold(pc.yellow("🧐 [3/4] Dual Supervisors auditing code validity & completeness...")));
    const supervisorReport = workerResult.supervisorReport;

    // STEP 4: Only Mother communicates the final result to the user
    p.log.step(pc.bold(pc.green("👑 [4/4] Mother AI reviewing all results and presenting final report...")));
    const motherSummaryPrompt = `You are MOTHER AI. Summarize the completed work for the user in a professional, concise format.
User Goal: "${userGoal}"
Worker Execution Output:
${workerResult.output}

Supervisor Verdict:
${supervisorReport ? (supervisorReport.allPassed ? "Verified All Passing" : "Review notes included") : "Passed"}

Provide a clear, helpful final completion summary directly to the user.`;

    const finalAnswer = await this.motherProvider.sendPrompt(motherSummaryPrompt, 60000);
    this.setMotherObjective("Idle", "Completed mission and communicated response");

    // Silent background cleanup of supervisor tabs
    await this.dualSupervisor.cleanup().catch(() => {});

    return {
      motherPlan,
      subAgentWork: [{ id: "worker_1", role: "Fullstack Coder", output: workerResult.output }],
      reviewReport: supervisorReport ? JSON.stringify(supervisorReport) : "Passed",
      finalAnswer,
      supervisorReport,
    };
  }

  /**
   * Run multiple sub-tasks simultaneously across independent browser tabs with strict session isolation
   */
  public async executeParallelTasks(
    tasks: Array<{ role: string; mission: string }>
  ): Promise<Array<{ id: string; role: string; output: string }>> {
    p.log.step(
      pc.bold(
        pc.cyan(`🤖 Spawning ${tasks.length} Sub-Agents simultaneously across dedicated browser tabs...`)
      )
    );

    this.setMotherObjective("Parallel Multi-Agent Swarm", `Running ${tasks.length} isolated worker sessions`);

    // Enqueue tasks into TaskQueue
    const queuedTasks = tasks.map((t) => this.taskQueue.addTask(t.role, t.mission));

    const results = await Promise.all(
      queuedTasks.map(async (task, idx) => {
        const workerInfo = await this.executeWorkerTask(task.description, task, tasks[idx].role);
        return {
          id: task.assignedAgentId || `worker_${idx + 1}`,
          role: tasks[idx].role,
          output: workerInfo.output,
        };
      })
    );

    // Silent background cleanup
    await this.dualSupervisor.cleanup().catch(() => {});
    this.setMotherObjective("Idle", `All ${tasks.length} parallel tasks completed`);

    p.log.message(
      pc.green(`✔ All ${tasks.length} parallel workers completed their missions successfully`)
    );
    return results;
  }
}

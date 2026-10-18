import { GeminiBrowserProvider } from "../providers";
import { AgentLoop } from "./loop";
import { LocalWorkspace } from "../tools/workspace";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { createAgentReporter, LiveStreamFormatter } from "../cli/reporter";
import { classifyTask, type AgentMode } from "./classifier";

export interface OrchestrationResult {
  motherPlan: string;
  subAgentWork: Array<{ id: string; role: string; output: string }>;
  reviewReport: string;
}

export class MultiAgentOrchestrator {
  private motherProvider: GeminiBrowserProvider;
  private reviewerProvider: GeminiBrowserProvider;
  private subAgentCounter = 0;
  private workspace: LocalWorkspace;

  constructor(workspaceDir?: string) {
    this.workspace = new LocalWorkspace(workspaceDir);
    // Tab 1: Mother (Coordinator)
    this.motherProvider = new GeminiBrowserProvider("mother", "Mother (Lead Architect)");
    // Tab 2: Reviewer (QA / Code Quality)
    this.reviewerProvider = new GeminiBrowserProvider("reviewer", "Reviewer (Code Inspector)");
  }

  public getMotherProvider() {
    return this.motherProvider;
  }

  /**
   * Spawns a dedicated sub-agent in a new browser tab
   */
  public createSubAgent(role: string = "Coder"): { id: string; loop: AgentLoop } {
    this.subAgentCounter++;
    const id = `sub_${this.subAgentCounter}`;
    const provider = new GeminiBrowserProvider(id, `Sub-Agent ${this.subAgentCounter} (${role})`);
    const loop = new AgentLoop(provider, this.workspace.getBaseDir(), 6);
    return { id, loop };
  }

  /**
   * Ask the Mother AI to classify whether a task needs multi-agent or solo execution.
   *
   * Sends a tiny structured prompt to the live Mother browser tab and parses its JSON
   * decision — no keyword matching, no heuristics, just Gemini deciding.
   *
   * Falls back to the local keyword classifier if the AI is unavailable or returns
   * unparseable output (e.g. Chrome not connected yet).
   */
  public async aiClassifyTask(userGoal: string): Promise<{
    mode: AgentMode;
    reason: string;
    confidence: "high" | "medium" | "low";
    source: "ai" | "local";
    tasks?: string[];
  }> {
    // Only attempt AI classification when Chrome is actually connected
    if (!this.motherProvider.isReady()) {
      const local = classifyTask(userGoal);
      return { ...local, source: "local" };
    }

    const classifyPrompt = `You are a task routing agent. Decide whether the following task needs a MULTI-AGENT team or a SOLO agent.
Also, if the task has 2 or more distinct sub-tasks, list them as a concise string array. If simple/single, leave tasks empty.

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

      // Extract the first JSON object from the response (AI may add prose around it)
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
      // AI unreachable / returned garbage — fall back silently to local classifier
      const local = classifyTask(userGoal);
      return { ...local, source: "local" };
    }
  }

  /**
   * Run the full multi-agent workflow:
   * 1. Mother decomposes task and assigns to sub-agents
   * 2. Sub-agents execute work in parallel/sequence in separate tabs
   * 3. Reviewer verifies code quality, checks errors, and tests
   * 4. Mother finalizes report
   */
  public async executeTask(userGoal: string): Promise<OrchestrationResult> {
    // STEP 1: Mother Plans with Real-Time Stream
    p.log.step(pc.bold(pc.magenta("👑 [1/3] Mother Agent is analyzing goal & planning sub-tasks...")));
    const motherStreamer = new LiveStreamFormatter();
    let motherStarted = false;

    const motherPlanPrompt = `You are MOTHER, the Lead Agent Architect.
Goal: "${userGoal}"

Analyze the task and break it down into 1 or 2 specific sub-tasks for your coder sub-agents.
Return your plan in concise bullet points.`;

    const motherPlan = await this.motherProvider.sendPrompt(
      motherPlanPrompt,
      180000,
      (chunk) => {
        if (!motherStarted) {
          p.log.info(pc.magenta("Mother plan streaming live from Tab 1:"));
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
    p.log.message(pc.green("✔ Mother created execution plan"));
    if (!motherStarted) {
      p.note(motherPlan, pc.magenta("Mother's Architectural Plan"));
    }

    // STEP 2: Sub-Agent Execution in Dedicated Tab with Full Stream
    p.log.step(pc.bold(pc.cyan("🤖 [2/3] Spawning Sub-Agent in Tab 2 to execute code & tools...")));
    const subAgent = this.createSubAgent("Fullstack Coder");

    const subAgentGoal = `EXECUTION MISSION:
${userGoal}

Execution Plan from Mother Architect:
${motherPlan}

IMPORTANT: Do NOT give advice or steps to the user. Immediately call 'run_command' or 'write_file' tools to perform the work now on disk.`;

    const subAgentOutput = await subAgent.loop.runTask(
      subAgentGoal,
      createAgentReporter(subAgent.id, { showTurn: true })
    );

    // STEP 3: Reviewer inspects code in Tab 3 with Real-Time Stream
    p.log.step(pc.bold(pc.yellow("🧐 [3/3] Reviewer Agent is inspecting code quality & running validation in Tab 3...")));
    const reviewerStreamer = new LiveStreamFormatter();
    let reviewerStarted = false;

    // Collect all files in workspace to give reviewer context
    const fileList = await this.workspace.listFiles(".");
    const reviewerPrompt = `You are the REVIEWER Agent. Your job is QA and quality validation.
User Goal: "${userGoal}"
Sub-Agent Accomplished:
${subAgentOutput}

Current Workspace Files:
${JSON.stringify(fileList.output)}

Please inspect the work:
1. Did the sub-agent fulfill the user's requirements?
2. Are there any obvious bugs or missing files?
3. Provide a final verdict (APPROVED or NEEDS_WORK) and concise feedback.`;

    const reviewReport = await this.reviewerProvider.sendPrompt(
      reviewerPrompt,
      180000,
      (chunk) => {
        if (!reviewerStarted) {
          p.log.info(pc.yellow("Reviewer audit streaming live from Tab 3:"));
          process.stdout.write(pc.dim("│") + "\n");
          reviewerStarted = true;
        }
        reviewerStreamer.write(chunk, (s) => pc.yellow(s));
      }
    );
    if (reviewerStarted) {
      reviewerStreamer.end();
      process.stdout.write(pc.dim("│") + "\n");
    }
    p.log.message(pc.green("✔ Reviewer completed audit"));
    if (!reviewerStarted) {
      p.note(reviewReport, pc.yellow("Reviewer Audit Report"));
    }

    // Reclaim RAM: close completed sub-agent and reviewer tabs to keep Chrome lean
    await Promise.allSettled([
      (subAgent.loop.getProvider() as GeminiBrowserProvider).closeTab(),
      this.reviewerProvider.closeTab(),
    ]);

    return {
      motherPlan,
      subAgentWork: [{ id: subAgent.id, role: "Fullstack Coder", output: subAgentOutput }],
      reviewReport,
    };
  }

  /**
   * Run multiple sub-tasks simultaneously across independent browser tabs with race-free file locking
   */
  public async executeParallelTasks(
    tasks: Array<{ role: string; mission: string }>
  ): Promise<Array<{ id: string; role: string; output: string }>> {
    p.log.step(
      pc.bold(
        pc.cyan(`🤖 Spawning ${tasks.length} Sub-Agents simultaneously across dedicated browser tabs...`)
      )
    );

    const subAgents = tasks.map((t) => ({
      task: t,
      agent: this.createSubAgent(t.role),
    }));

    // Launch all agent loops in parallel
    const results = await Promise.all(
      subAgents.map(async ({ task, agent }) => {
        const output = await agent.loop.runTask(
          task.mission,
          createAgentReporter(agent.id, { showTurn: true })
        );
        // Free Chrome RAM as soon as this sub-agent finishes its mission
        await (agent.loop.getProvider() as GeminiBrowserProvider).closeTab().catch(() => {});
        return {
          id: agent.id,
          role: task.role,
          output,
        };
      })
    );

    p.log.message(
      pc.green(`✔ All ${tasks.length} parallel sub-agents completed their missions successfully`)
    );
    return results;
  }
}


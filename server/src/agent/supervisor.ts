import type { AIProvider } from "../providers";
import { GeminiBrowserProvider } from "../providers";
import { LocalWorkspace } from "../tools/workspace";

export interface SupervisorEvaluation {
  passed: boolean;
  reason: string;
  supervisor: "supervisor_a" | "supervisor_b" | "fallback";
}

export interface DualSupervisorReport {
  allPassed: boolean;
  supervisorA: SupervisorEvaluation;
  supervisorB: SupervisorEvaluation;
  fallbackUsed: boolean;
  alertForMother?: string | null;
}

export class FallbackController {
  private workspace: LocalWorkspace;

  constructor(workspace: LocalWorkspace) {
    this.workspace = workspace;
  }

  /**
   * Deterministic local inspection: verifies disk state, file creations, and checks for hallucinated success
   */
  public async verifyTaskLocally(
    userGoal: string,
    workerOutput: string
  ): Promise<SupervisorEvaluation> {
    const outputLower = workerOutput.toLowerCase();

    // Check for clear failure or refusal keywords
    if (
      outputLower.includes("error:") ||
      outputLower.includes("failed to") ||
      outputLower.includes("i cannot") ||
      outputLower.includes("cannot complete")
    ) {
      return {
        passed: false,
        reason: "Worker reported errors or inability to complete task.",
        supervisor: "fallback",
      };
    }

    // Check if worker mentioned files created/written/updated and verify their presence
    const fileMentions = workerOutput.match(/(?:created|written|updated|file|into)\s+[`"']?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)[`"']?/gi);

    if (fileMentions && fileMentions.length > 0) {
      for (const mention of fileMentions) {
        const pathMatch = mention.match(/([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/);
        if (pathMatch) {
          const candidatePath = pathMatch[1].replace(/[`"']/g, "").trim();
          // Skip general extensions or placeholders
          if (candidatePath.includes("*") || candidatePath.endsWith(".md?") || candidatePath.length < 3) continue;

          const existsRes = await this.workspace.fileExists(candidatePath);
          const fileFound = existsRes.success && (existsRes.output === true || (typeof existsRes.output === "object" && existsRes.output?.exists));
          if (!fileFound) {
            // Mentioned file does not actually exist on disk -> False success / hallucination!
            return {
              passed: false,
              reason: `False success detected: Worker claimed work on '${candidatePath}', but the file does not exist on disk.`,
              supervisor: "fallback",
            };
          }
        }
      }
    }

    // If output is too short or just a greeting/placeholder for a coding task
    if (workerOutput.trim().length < 15) {
      return {
        passed: false,
        reason: "Worker output is too brief or empty.",
        supervisor: "fallback",
      };
    }

    return {
      passed: true,
      reason: "Deterministic fallback: Workspace files and worker output verified consistent with no anomalies.",
      supervisor: "fallback",
    };
  }
}

export class DualSupervisor {
  private supervisorA: GeminiBrowserProvider;
  private supervisorB: GeminiBrowserProvider;
  private fallbackController: FallbackController;
  private workspace: LocalWorkspace;

  constructor(workspace: LocalWorkspace) {
    this.workspace = workspace;
    this.fallbackController = new FallbackController(workspace);
    // Two independent sessions for dual verification
    this.supervisorA = new GeminiBrowserProvider("supervisor_a", "Supervisor A (Completeness Auditor)");
    this.supervisorB = new GeminiBrowserProvider("supervisor_b", "Supervisor B (Code & Hallucination Auditor)");
  }

  public getSupervisorA(): GeminiBrowserProvider {
    return this.supervisorA;
  }

  public getSupervisorB(): GeminiBrowserProvider {
    return this.supervisorB;
  }

  /**
   * Run verification with soft watchdog timeout (default 10s responsiveness threshold)
   */
  private async runSupervisorPrompt(
    provider: GeminiBrowserProvider,
    prompt: string,
    softTimeoutMs: number = 10000,
    maxTimeoutMs: number = 20000
  ): Promise<{ passed: boolean; reason: string }> {
    if (!provider.isReady()) {
      throw new Error("Provider not connected");
    }

    const aiPromise = provider.sendPrompt(prompt, maxTimeoutMs);

    // Soft timeout check: if AI doesn't complete within softTimeoutMs, we warn or fall back gracefully
    const timeoutPromise = new Promise<{ passed: boolean; reason: string }>((_, reject) => {
      setTimeout(() => reject(new Error("Supervisor response threshold exceeded (10s soft timeout)")), softTimeoutMs);
    });

    const raw = await Promise.race([aiPromise, timeoutPromise]);
    const jsonMatch = typeof raw === "string" ? raw.match(/\{[\s\S]*?"verdict"[\s\S]*?\}/) : null;

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const passed = parsed.verdict?.toUpperCase() === "PASS" || parsed.verdict?.toUpperCase() === "APPROVED";
        const reason = parsed.reason || (passed ? "Approved by supervisor" : "Rejected by supervisor");
        return { passed, reason };
      } catch {}
    }

    // Text fallback
    const rawUpper = String(raw).toUpperCase();
    const passed = (rawUpper.includes("PASS") || rawUpper.includes("APPROVED")) && !rawUpper.includes("FAIL") && !rawUpper.includes("REJECTED");
    return {
      passed,
      reason: String(raw).slice(0, 200).replace(/\r?\n/g, " "),
    };
  }

  /**
   * Run both Supervisor A and Supervisor B independently, falling back seamlessly if either times out or fails
   */
  public async reviewWorkerTask(
    userGoal: string,
    taskTitle: string,
    workerOutput: string,
    softTimeoutMs: number = 10000
  ): Promise<DualSupervisorReport> {
    const promptA = `You are SUPERVISOR A (Requirements Completeness Auditor).
User Goal: "${userGoal}"
Assigned Task: "${taskTitle}"
Worker Accomplished:
${workerOutput}

Verify:
1. Did the worker address the assigned task completely?
2. Did the worker avoid ignoring key instructions or requirements?

Respond in JSON ONLY:
{"verdict": "PASS" | "FAIL", "reason": "<concise explanation>"}`;

    const promptB = `You are SUPERVISOR B (Code Validity & Hallucination Auditor).
User Goal: "${userGoal}"
Assigned Task: "${taskTitle}"
Worker Accomplished:
${workerOutput}

Verify:
1. Is the output free from fake claims, false successes, or made-up paths?
2. Does the solution appear logically sound and free of blatant syntax/runtime errors?

Respond in JSON ONLY:
{"verdict": "PASS" | "FAIL", "reason": "<concise explanation>"}`;

    let evalA: SupervisorEvaluation;
    let evalB: SupervisorEvaluation;
    let fallbackUsed = false;

    // Run Supervisor A
    try {
      const resA = await this.runSupervisorPrompt(this.supervisorA, promptA, softTimeoutMs);
      evalA = { passed: resA.passed, reason: resA.reason, supervisor: "supervisor_a" };
    } catch {
      fallbackUsed = true;
      evalA = await this.fallbackController.verifyTaskLocally(taskTitle, workerOutput);
      evalA.reason = `[Supervisor A Fallback]: ${evalA.reason}`;
    }

    // Run Supervisor B
    try {
      const resB = await this.runSupervisorPrompt(this.supervisorB, promptB, softTimeoutMs);
      evalB = { passed: resB.passed, reason: resB.reason, supervisor: "supervisor_b" };
    } catch {
      fallbackUsed = true;
      evalB = await this.fallbackController.verifyTaskLocally(taskTitle, workerOutput);
      evalB.reason = `[Supervisor B Fallback]: ${evalB.reason}`;
    }

    const allPassed = evalA.passed && evalB.passed;
    let alertForMother: string | null = null;

    if (!allPassed) {
      alertForMother = `Supervisor Alert for task "${taskTitle}": ` +
        (!evalA.passed ? `[Supervisor A]: ${evalA.reason}. ` : "") +
        (!evalB.passed ? `[Supervisor B]: ${evalB.reason}.` : "");
    }

    return {
      allPassed,
      supervisorA: evalA,
      supervisorB: evalB,
      fallbackUsed,
      alertForMother,
    };
  }

  /**
   * Silent background cleanup of supervisor tabs
   */
  public async cleanup(): Promise<void> {
    await Promise.allSettled([
      this.supervisorA.closeTab().catch(() => {}),
      this.supervisorB.closeTab().catch(() => {}),
    ]);
  }
}

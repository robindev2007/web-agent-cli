import { describe, it, expect } from "bun:test";
import { MultiAgentOrchestrator } from "../src/agent/orchestrator";

describe("Orchestrator AI Task Classification", () => {
  it("falls back to local classifier when Mother provider is not ready", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    // motherProvider is not connected to Chrome, so isReady() === false
    const res = await orchestrator.aiClassifyTask("Create a simple text file hello.txt");
    
    expect(res).toBeDefined();
    expect(res.source).toBe("local");
    expect(res.mode).toBe("single");
    expect(typeof res.reason).toBe("string");
  });

  it("classifies complex mission as multi via fallback when disconnected", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    const res = await orchestrator.aiClassifyTask(
      "Build a fullstack e-commerce app with Postgres database, JWT authentication, and deploy to AWS"
    );

    expect(res.source).toBe("local");
    expect(res.mode).toBe("multi");
    expect(res.confidence).toBe("high");
  });

  it("handles AI response when Mother provider returns valid JSON", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    const mother = orchestrator.getMotherProvider();

    // Mock isReady & sendPrompt
    (mother as any).isReady = () => true;
    (mother as any).sendPrompt = async () => {
      return '```json\n{"mode":"multi","reason":"Requires frontend and backend work","confidence":"high"}\n```';
    };

    const res = await orchestrator.aiClassifyTask("Build a dashboard app");
    expect(res.source).toBe("ai");
    expect(res.mode).toBe("multi");
    expect(res.reason).toBe("Requires frontend and backend work");
    expect(res.confidence).toBe("high");
  });

  it("gracefully falls back when AI returns malformed response", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    const mother = orchestrator.getMotherProvider();

    (mother as any).isReady = () => true;
    (mother as any).sendPrompt = async () => {
      return "I think you should use a single agent for this simple task.";
    };

    const res = await orchestrator.aiClassifyTask("List directory contents");
    expect(res.source).toBe("local");
    expect(res.mode).toBe("single");
  });
});


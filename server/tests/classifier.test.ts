import { describe, it, expect } from "bun:test";
import { classifyTask } from "../src/agent/classifier";

describe("Task Classifier — auto mode selection", () => {
  // ── Multi-agent cases ──────────────────────────────────────────────────────

  it("full-stack app → multi", () => {
    const r = classifyTask("Build a full-stack todo app with React frontend and Express backend");
    expect(r.mode).toBe("multi");
    expect(r.multiScore).toBeGreaterThan(r.singleScore);
  });

  it("authentication system → multi", () => {
    const r = classifyTask("Create a JWT authentication system with login, register, and refresh tokens");
    expect(r.mode).toBe("multi");
  });

  it("multi-step pipeline → multi", () => {
    const r = classifyTask(
      "Set up a Postgres database with Prisma, write the API routes, then add unit tests and deploy with Docker"
    );
    expect(r.mode).toBe("multi");
    expect(r.multiScore).toBeGreaterThan(r.singleScore);
  });

  it("large project scaffold → multi", () => {
    const r = classifyTask("Scaffold a new Next.js project with TypeScript, Tailwind CSS, and Prisma ORM");
    expect(r.mode).toBe("multi");
  });

  it("refactor + tests → multi", () => {
    const r = classifyTask("Refactor the entire codebase to use async/await and add comprehensive tests");
    expect(r.mode).toBe("multi");
  });

  it("deploy + CI/CD → multi", () => {
    const r = classifyTask("Set up GitHub Actions CI/CD pipeline and deploy to Vercel");
    expect(r.mode).toBe("multi");
  });

  // ── Single-agent cases ─────────────────────────────────────────────────────

  it("fix a bug → single", () => {
    const r = classifyTask("Fix the null pointer error in utils.ts");
    expect(r.mode).toBe("single");
    expect(r.singleScore).toBeGreaterThan(r.multiScore);
  });

  it("read a file → single", () => {
    const r = classifyTask("Read package.json and show me the dependencies");
    expect(r.mode).toBe("single");
  });

  it("simple script → single", () => {
    const r = classifyTask("Write a simple hello world script in TypeScript");
    expect(r.mode).toBe("single");
  });

  it("question/lookup → single", () => {
    const r = classifyTask("List all files in the src directory");
    expect(r.mode).toBe("single");
  });

  it("rename file → single", () => {
    const r = classifyTask("Rename utils.ts to helpers.ts");
    expect(r.mode).toBe("single");
  });

  it("quick one-liner → single", () => {
    const r = classifyTask("Run bun install");
    expect(r.mode).toBe("single");
  });

  // ── Confidence checks ──────────────────────────────────────────────────────

  it("obvious multi task has high confidence", () => {
    const r = classifyTask(
      "Build a full-stack e-commerce platform with React frontend, Node.js backend, Postgres database, JWT auth, Stripe payments, and deploy it to AWS"
    );
    expect(r.mode).toBe("multi");
    expect(r.confidence).toBe("high");
  });

  it("obvious single task has high confidence", () => {
    const r = classifyTask("echo hello");
    expect(r.mode).toBe("single");
    expect(r.confidence).toBe("high");
  });

  // ── Result shape ───────────────────────────────────────────────────────────

  it("always returns valid shape", () => {
    const r = classifyTask("do something");
    expect(typeof r.mode).toBe("string");
    expect(["multi", "single"]).toContain(r.mode);
    expect(["high", "medium", "low"]).toContain(r.confidence);
    expect(typeof r.reason).toBe("string");
    expect(r.reason.length).toBeGreaterThan(0);
    expect(typeof r.multiScore).toBe("number");
    expect(typeof r.singleScore).toBe("number");
  });
});


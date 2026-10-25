import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inputSchema } from "../shared/input.js";
import { quotaReport } from "./quota.js";
import { discover, fetchUsage } from "./usage.js";

const resetAt = "2030-10-25T18:00:00.000Z";

describe("per-account quota conversion", () => {
  it("preserves remaining percentage precision and the real reset instead of rounded used counts", () => {
    const report = quotaReport("antigravity", {
      plan: "PRO",
      quotas: {
        gemini_session: { used: 559, total: 1000, remainingPercentage: 44.09272, resetAt },
        gemini_weekly: { used: 1000, total: 1000, remainingPercentage: 0, resetAt },
        claude_gpt_session: { used: 0, total: 1000, remainingPercentage: 100, resetAt },
        claude_gpt_weekly: { used: 581, total: 1000, remainingPercentage: 41.9, resetAt },
        "gemini-3.1-flash-image": { used: 3, total: 1000, remainingPercentage: 99.7, resetAt },
        "gemini-flash-low": { used: 900, total: 1000, remainingPercentage: 10 },
        "claude-sonnet": { used: 1000, total: 1000, remainingPercentage: 0 },
        "gpt-oss-model": { used: 1000, total: 1000, remainingPercentage: 0 },
      },
      subscriptionInfo: { accessToken: "private-provider-token-sentinel" },
    });
    expect(report.status).toBe("available");
    if (report.status !== "available") throw new Error("Expected a quota report");
    expect(report.windows.map((window) => window.id)).toEqual([
      "gemini_session",
      "gemini_weekly",
      "claude_gpt_session",
      "claude_gpt_weekly",
      "gemini-3.1-flash-image",
    ]);
    const session = report.windows.find((window) => window.id === "gemini_session")!;
    expect(session.remainingPct).toBeCloseTo(44.09272);
    expect(session.usedPct).toBeCloseTo(55.90728);
    expect(session.tone).toBe("warning");
    expect(Date.parse(session.resetsAt!)).toBe(Date.parse(resetAt));
    expect(report.windows.find((window) => window.id === "gemini_weekly")?.remainingPct).toBe(0);
    expect(report.windows.find((window) => window.id === "claude_gpt_session")?.remainingPct).toBe(
      100,
    );
    expect(JSON.stringify(report)).not.toContain("private-provider-token-sentinel");
    expect(report.balances).toBeUndefined();
  });

  it("derives Codex remaining quota from limits without reversing used and remaining", () => {
    const report = quotaReport("codex", {
      quotas: {
        session: { used: 13, total: 100, remaining: 87, resetAt },
        weekly: { used: 76, total: 100, resetAt },
      },
    });
    expect(report.status).toBe("available");
    if (report.status !== "available") throw new Error("Expected a quota report");
    expect(report.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "session", usedPct: 13, remainingPct: 87, tone: "ok" }),
        expect.objectContaining({ id: "weekly", usedPct: 76, remainingPct: 24, tone: "danger" }),
      ]),
    );
  });

  it("matches tracker colors at rounded remaining-percentage boundaries", () => {
    const report = quotaReport("kiro", {
      quotas: {
        seventy: { remainingPercentage: 70.4 },
        seventyOne: { remainingPercentage: 70.6 },
        thirty: { remainingPercentage: 29.6 },
        twentyNine: { remainingPercentage: 29.4 },
      },
    });
    expect(report.status).toBe("available");
    if (report.status !== "available") throw new Error("Expected a quota report");
    expect(report.windows.map((window) => window.tone)).toEqual([
      "warning",
      "ok",
      "warning",
      "danger",
    ]);
    expect(report.windows[0]?.remainingPct).toBeCloseTo(70.4);
  });

  it("never treats unknown or unlimited limits as 100% remaining", () => {
    const report = quotaReport("kiro", {
      quotas: {
        unknown: { used: 0, total: 0 },
        unlimited: { unlimited: true, remainingPercentage: 100 },
        exhausted: { used: 1200, total: 1000 },
      },
    });
    expect(report.status).toBe("available");
    if (report.status !== "available") throw new Error("Expected a quota report");
    expect(report.windows.find((window) => window.id === "unknown")?.remainingPct).toBeNull();
    expect(report.windows.find((window) => window.id === "unlimited")?.remainingPct).toBeNull();
    expect(report.windows.find((window) => window.id === "exhausted")?.remainingPct).toBe(0);
    expect(quotaReport("kiro", { quotas: {} }).status).toBe("unavailable");
  });

  it("selects the most constrained legacy family without duplicating an exhausted weekly budget", () => {
    const report = quotaReport("antigravity", {
      quotas: {
        "gemini-model-a": { used: 100, total: 1000, resetAt },
        "gemini-model-b": { used: 800, total: 1000, resetAt },
        "claude-model": { used: 1000, total: 1000, resetAt },
        claude_gpt_weekly: { used: 1000, total: 1000, resetAt },
      },
    });
    expect(report.status).toBe("available");
    if (report.status !== "available") throw new Error("Expected a quota report");
    expect(report.windows.map((window) => window.id)).toEqual(["gemini", "claude_gpt_weekly"]);
    expect(report.windows[0]?.remainingPct).toBe(20);
  });
});

describe("9router account discovery and errors", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "paseo-9router-account-"));
    await mkdir(join(dataDir, "auth"));
    await writeFile(join(dataDir, "machine-id"), "fixture-machine");
    await writeFile(join(dataDir, "auth", "cli-secret"), "fixture-cli-secret");
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("keeps two accounts of one provider distinct across paginated discovery without exposing credentials", async () => {
    const a = {
      id: "account-a",
      provider: "codex",
      name: "A",
      email: "a@example.test",
      isActive: true,
      testStatus: "active",
      accessToken: "provider-key-sentinel",
    };
    const b = {
      id: "account-b",
      provider: "codex",
      name: "B",
      email: "b@example.test",
      isActive: false,
      testStatus: "unavailable",
    };
    const fetchApi: typeof fetch = async (url) =>
      Response.json({
        connections: new URL(String(url)).searchParams.get("page") === "1" ? [a] : [a, b],
        pagination: { totalPages: 2 },
      });
    const accounts = await discover(dataDir, fetchApi);
    expect(accounts.map((account) => account.label)).toEqual(["a@example.test", "b@example.test"]);
    expect(new Set(accounts.map((account) => account.key)).size).toBe(2);
    expect(accounts.map((account) => inputSchema.parse(account.input).connectionId)).toEqual([
      "account-a",
      "account-b",
    ]);
    const serialized = JSON.stringify(accounts);
    for (const secret of ["fixture-machine", "fixture-cli-secret", "provider-key-sentinel"])
      expect(serialized).not.toContain(secret);
    expect(await discover(join(dataDir, "not-configured"), fetchApi)).toEqual([]);
  });

  it("does not turn rejected account access into an empty or fully available quota", async () => {
    const input = {
      dataDir,
      connectionId: "account-a",
      provider: "codex",
      enabled: true,
      status: "active",
    };
    const rejected: typeof fetch = async () =>
      Response.json({ error: "private-error-token-sentinel" }, { status: 401 });
    const report = await fetchUsage(input, rejected);
    expect(report).toMatchObject({
      status: "unavailable",
      problem: { kind: "rejected", status: 401 },
    });
    expect(JSON.stringify(report)).not.toContain("private-error-token-sentinel");
    const unavailable: typeof fetch = async () => Response.json({}, { status: 503 });
    await expect(fetchUsage(input, unavailable)).rejects.toThrow("HTTP 503");
  });
});

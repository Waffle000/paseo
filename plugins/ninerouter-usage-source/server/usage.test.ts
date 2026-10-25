import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discover, fetchUsage } from "./usage.js";

interface FixtureDatabase {
  exec(sql: string): void;
  prepare(sql: string): { run(...bindings: unknown[]): void };
  close(): void;
}
// The runtime has SQLite; the plugin workspace's Node 20 typings do not declare it.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => FixtureDatabase;
};
let root: string;
let path: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "paseo-9router-usage-"));
  path = join(root, "data.sqlite");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE usageDaily (dateKey TEXT PRIMARY KEY, data TEXT NOT NULL)");
  db.close();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function writeBucket(day: string, data: Record<string, unknown>): void {
  const db = new DatabaseSync(path);
  try {
    db.prepare("INSERT INTO usageDaily (dateKey, data) VALUES (?, ?)").run(
      day,
      JSON.stringify(data),
    );
  } finally {
    db.close();
  }
}

describe("9router recorded usage", () => {
  it("keeps cumulative totals separate from the selected day and never returns API key maps", async () => {
    writeBucket("2026-10-24", { requests: 3, promptTokens: 100, completionTokens: 20, cost: 0.25 });
    writeBucket("2026-10-25", {
      requests: 2,
      promptTokens: 200,
      completionTokens: 30,
      cost: 0.5,
      byApiKey: { "private-api-key-sentinel": { requests: 2 } },
      byAccount: { "private-account-sentinel": { requests: 2 } },
    });
    const report = await fetchUsage({ path }, new Date("2026-10-25T23:59:59Z"));
    expect(report.status).toBe("available");
    if (report.status !== "available") throw new Error("Usage should be available");
    expect(report.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "requests", used: 5, unit: "requests" }),
        expect.objectContaining({ id: "tokens", used: 350, unit: "tokens" }),
        expect.objectContaining({ id: "estimated_cost", used: 0.75, unit: "usd" }),
      ]),
    );
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "daily_bucket", value: "2026-10-25" }),
        expect.objectContaining({ id: "daily_requests", value: "2" }),
        expect.objectContaining({ id: "daily_tokens", value: "230" }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("private-api-key-sentinel");
    expect(JSON.stringify(report)).not.toContain("private-account-sentinel");
    expect(report.windows).toEqual([]);
    expect(report.balances?.every((balance) => balance.limit === undefined)).toBe(true);
  });

  it("reports zero recorded activity for an empty metric store", async () => {
    const report = await fetchUsage({ path });
    expect(report.status).toBe("available");
    if (report.status !== "available") throw new Error("Usage should be available");
    expect(report.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "requests", used: 0 }),
        expect.objectContaining({ id: "tokens", used: 0 }),
        expect.objectContaining({ id: "estimated_cost", used: 0 }),
      ]),
    );
    expect(await discover(join(root, "missing.sqlite"))).toEqual([]);
  });

  it("rejects incomplete daily metrics instead of silently showing invented zero usage", async () => {
    writeBucket("2026-10-25", { requests: 2, promptTokens: 200, completionTokens: 30 });
    await expect(fetchUsage({ path })).rejects.toThrow("Unsupported 9router daily usage data");
  });
});

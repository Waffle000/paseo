import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { hashAccountKey } from "@getpaseo/plugin/server/usage";
import type { UsageAccount, UsageReport } from "@getpaseo/plugin/server/usage";
import type { Input } from "../shared/input.js";

// The plugin workspace uses Node 20 typings; the daemon's Node 22+ runtime supplies SQLite.
interface MetricDatabase {
  prepare(sql: string): { get(...bindings: unknown[]): unknown };
  close(): void;
}
interface Sqlite {
  DatabaseSync: new (path: string, options: { readOnly: boolean }) => MetricDatabase;
}

// Node 20 typings omit SQLite, and evaluated plugin bundles do not have import.meta.url.
const sqlite = process.getBuiltinModule("node:sqlite") as Sqlite | undefined;
if (!sqlite) throw new Error("9router usage requires a Node runtime with SQLite support.");
const { DatabaseSync } = sqlite;

const count = z.number().int().nonnegative();
const metricsSchema = z.object({
  requests: count,
  inputTokens: count,
  outputTokens: count,
  cost: z.number().finite().nonnegative(),
  dayRequests: count,
  dayInputTokens: count,
  dayOutputTokens: count,
  dayCost: z.number().finite().nonnegative(),
  invalidRows: count,
});
const numbers = new Intl.NumberFormat("en-US");

export async function discover(
  path = join(homedir(), ".9router", "db", "data.sqlite"),
): Promise<UsageAccount[]> {
  return existsSync(path)
    ? [{ key: hashAccountKey(path), label: "Local 9router", input: { path } }]
    : [];
}

export async function fetchUsage(input: Input, now = new Date()): Promise<UsageReport> {
  const db = new DatabaseSync(input.path, { readOnly: true });
  const day = now.toISOString().slice(0, 10);
  try {
    // Read daily aggregates, not request bodies, API keys, account credentials, or private logs.
    // One statement keeps the total and selected daily bucket in the same SQLite snapshot.
    const metrics = metricsSchema.parse(
      db
        .prepare(`
      SELECT
        COALESCE(SUM(json_extract(data, '$.requests')), 0) AS requests,
        COALESCE(SUM(json_extract(data, '$.promptTokens')), 0) AS inputTokens,
        COALESCE(SUM(json_extract(data, '$.completionTokens')), 0) AS outputTokens,
        COALESCE(SUM(json_extract(data, '$.cost')), 0) AS cost,
        COALESCE(SUM(CASE WHEN dateKey = ? THEN json_extract(data, '$.requests') ELSE 0 END), 0) AS dayRequests,
        COALESCE(SUM(CASE WHEN dateKey = ? THEN json_extract(data, '$.promptTokens') ELSE 0 END), 0) AS dayInputTokens,
        COALESCE(SUM(CASE WHEN dateKey = ? THEN json_extract(data, '$.completionTokens') ELSE 0 END), 0) AS dayOutputTokens,
        COALESCE(SUM(CASE WHEN dateKey = ? THEN json_extract(data, '$.cost') ELSE 0 END), 0) AS dayCost,
        COALESCE(SUM(CASE WHEN
          json_type(data, '$.requests') IN ('integer', 'real') AND
          json_type(data, '$.promptTokens') IN ('integer', 'real') AND
          json_type(data, '$.completionTokens') IN ('integer', 'real') AND
          json_type(data, '$.cost') IN ('integer', 'real')
          THEN 0 ELSE 1 END), 0) AS invalidRows
      FROM usageDaily
    `)
        .get(day, day, day, day),
    );
    if (metrics.invalidRows > 0) throw new Error("Unsupported 9router daily usage data.");
    return {
      status: "available",
      planLabel: "Recorded local traffic",
      windows: [],
      balances: [
        { id: "requests", label: "Recorded requests", used: metrics.requests, unit: "requests" },
        {
          id: "tokens",
          label: "Recorded tokens",
          used: metrics.inputTokens + metrics.outputTokens,
          unit: "tokens",
        },
        { id: "estimated_cost", label: "Estimated cost", used: metrics.cost, unit: "usd" },
      ],
      details: [
        { id: "input_tokens", label: "Input tokens", value: numbers.format(metrics.inputTokens) },
        {
          id: "output_tokens",
          label: "Output tokens",
          value: numbers.format(metrics.outputTokens),
        },
        { id: "daily_bucket", label: "Daily bucket", value: day },
        {
          id: "daily_requests",
          label: "Bucket requests",
          value: numbers.format(metrics.dayRequests),
        },
        {
          id: "daily_tokens",
          label: "Bucket tokens",
          value: numbers.format(metrics.dayInputTokens + metrics.dayOutputTokens),
        },
        {
          id: "daily_estimated_cost",
          label: "Bucket estimated cost",
          value: `$${metrics.dayCost.toFixed(4)}`,
        },
      ],
    };
  } finally {
    db.close();
  }
}

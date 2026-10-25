import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { BuiltinPluginLoader, resolveBuiltinPluginsRoot } from "./builtin/index.js";

test("9router metrics load in the real plugin evaluator and refresh after a producer update", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-9router-runtime-"));
  const plugins = path.join(root, "plugins");
  const directory = path.join(plugins, "ninerouter-usage-source");
  await mkdir(plugins);
  await cp(path.join(resolveBuiltinPluginsRoot(), "ninerouter-usage-source"), directory, {
    recursive: true,
  });
  const dbPath = path.join(root, "data.sqlite");
  const writer = new DatabaseSync(dbPath);
  writer.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE usageDaily (dateKey TEXT PRIMARY KEY, data TEXT NOT NULL)",
  );
  const update = writer.prepare("INSERT OR REPLACE INTO usageDaily (dateKey, data) VALUES (?, ?)");
  update.run(
    "2026-10-25",
    JSON.stringify({ requests: 1, promptTokens: 10, completionTokens: 3, cost: 0.05 }),
  );
  // Inject only the discovery path. The actual reader is still compiled/evaluated by the daemon.
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { inputSchema } from './shared/input.js';
import { discover, fetchUsage } from './server/usage.js';
export default function contribute(server) {
  server.registerUsageSource({ id: 'ninerouter', label: '9router', input: inputSchema,
    discover: () => discover(${JSON.stringify(dbPath)}), fetch: fetchUsage });
  return () => {};
}
`,
  );
  const daemon = await createTestPaseoDaemon({
    pluginsEnabled: false,
    builtinPlugins: new BuiltinPluginLoader(plugins, ["ninerouter-usage-source"]),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const first = (await client.listUsageReports()).reports.find(
      (entry) => entry.sourceId === "ninerouter",
    );
    expect(first?.report).toMatchObject({
      status: "available",
      balances: expect.arrayContaining([
        expect.objectContaining({ id: "requests", used: 1 }),
        expect.objectContaining({ id: "tokens", used: 13 }),
      ]),
    });
    update.run(
      "2026-10-25",
      JSON.stringify({
        requests: 2,
        promptTokens: 20,
        completionTokens: 5,
        cost: 0.1,
        byApiKey: { "private-key-sentinel": { requests: 2 } },
      }),
    );
    const refreshed = (await client.listUsageReports({ forceRefresh: true })).reports.find(
      (entry) => entry.sourceId === "ninerouter",
    );
    expect(refreshed?.report).toMatchObject({
      status: "available",
      balances: expect.arrayContaining([
        expect.objectContaining({ id: "requests", used: 2 }),
        expect.objectContaining({ id: "tokens", used: 25 }),
      ]),
    });
    expect(JSON.stringify(refreshed)).not.toContain("private-key-sentinel");
  } finally {
    await client.close();
    await daemon.close();
    writer.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import type { TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { BuiltinPluginLoader, resolveBuiltinPluginsRoot } from "./builtin/index.js";

test("9router publishes distinct account quotas, refreshes one account and never forwards CLI auth through redirects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-9router-quota-"));
  const plugins = path.join(root, "plugins");
  const directory = path.join(plugins, "ninerouter-usage-source");
  const auth = createHash("sha256")
    .update("fixture-machine9r-cli-authfixture-cli-secret")
    .digest("hex")
    .slice(0, 16);
  let usedA = 100;
  let redirectA = false;
  let redirectedRequests = 0;
  const receiver = createServer((_request, response) => {
    redirectedRequests++;
    response.end("untrusted");
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const receiverAddress = receiver.address();
  if (!receiverAddress || typeof receiverAddress === "string")
    throw new Error("Missing test receiver");
  const upstream = createServer((request, response) => {
    if (request.method !== "GET" || request.headers["x-9r-cli-token"] !== auth) {
      response.writeHead(401).end();
      return;
    }
    const url = new URL(request.url!, "http://127.0.0.1");
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/providers/client") {
      response.end(
        JSON.stringify({
          connections: [
            {
              id: "account-a",
              provider: "codex",
              name: "A",
              email: "a@example.test",
              isActive: true,
              testStatus: "active",
              accessToken: "private-provider-sentinel",
            },
            {
              id: "account-b",
              provider: "codex",
              name: "B",
              email: "b@example.test",
              isActive: true,
              testStatus: "active",
            },
          ],
          pagination: { totalPages: 1 },
        }),
      );
      return;
    }
    if (url.pathname === "/api/usage/account-a" || url.pathname === "/api/usage/account-b") {
      if (url.pathname.endsWith("account-a") && redirectA) {
        response
          .writeHead(302, { Location: `http://127.0.0.1:${receiverAddress.port}/capture` })
          .end();
        return;
      }
      response.end(
        JSON.stringify({
          plan: "plus",
          quotas: {
            session: {
              used: url.pathname.endsWith("account-a") ? usedA : 13,
              total: 100,
              resetAt: "2030-10-25T18:00:00.000Z",
            },
          },
          subscriptionInfo: { accessToken: "private-provider-sentinel" },
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("Missing quota fixture");
  let daemon: TestPaseoDaemon | undefined;
  let client: DaemonClient | undefined;
  try {
    await mkdir(plugins);
    await mkdir(path.join(root, "auth"));
    await writeFile(path.join(root, "machine-id"), "fixture-machine\n");
    await writeFile(path.join(root, "auth", "cli-secret"), "fixture-cli-secret\n");
    await cp(path.join(resolveBuiltinPluginsRoot(), "ninerouter-usage-source"), directory, {
      recursive: true,
    });
    // Inject only the local fixture origin and credential directory; compile/evaluate the real reader.
    await writeFile(
      path.join(directory, "index.server.ts"),
      `
import { inputSchema } from './shared/input.js';
import { discover, fetchUsage } from './server/usage.js';
const quotaFetch = (url, init) => {
  const target = new URL(String(url));
  target.host = '127.0.0.1:${address.port}';
  return fetch(target, init);
};
export default function contribute(server) {
  server.registerUsageSource({ id: 'ninerouter', label: '9router', input: inputSchema,
    discover: () => discover(${JSON.stringify(root)}, quotaFetch),
    fetch: (input) => fetchUsage(input, quotaFetch) });
  return () => {};
}
`,
    );
    daemon = await createTestPaseoDaemon({
      pluginsEnabled: false,
      builtinPlugins: new BuiltinPluginLoader(plugins, ["ninerouter-usage-source"]),
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    const first = (await client.listUsageReports()).reports.filter(
      (entry) => entry.sourceId === "ninerouter",
    );
    expect(first.map((entry) => entry.account.label).sort()).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
    const a = first.find((entry) => entry.account.label === "a@example.test")!;
    const b = first.find((entry) => entry.account.label === "b@example.test")!;
    expect(a.id).not.toBe(b.id);
    expect(a.report).toMatchObject({
      status: "available",
      windows: [expect.objectContaining({ usedPct: 100, remainingPct: 0, tone: "danger" })],
    });
    expect(b.report).toMatchObject({
      status: "available",
      windows: [expect.objectContaining({ usedPct: 13, remainingPct: 87, tone: "ok" })],
    });
    usedA = 25;
    const refreshed = (await client.listUsageReports({ reportIds: [a.id], forceRefresh: true }))
      .reports;
    expect(refreshed).toMatchObject([
      {
        id: a.id,
        report: { status: "available", windows: [expect.objectContaining({ remainingPct: 75 })] },
      },
    ]);
    expect(JSON.stringify(first)).not.toContain("private-provider-sentinel");
    expect(JSON.stringify(first)).not.toContain("fixture-cli-secret");
    redirectA = true;
    const denied = (await client.listUsageReports({ reportIds: [a.id], forceRefresh: true }))
      .reports;
    expect(denied[0]?.report.status).toBe("error");
    expect(redirectedRequests).toBe(0);
  } finally {
    await client?.close();
    await daemon?.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

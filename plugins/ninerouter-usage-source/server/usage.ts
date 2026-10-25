import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { hashAccountKey, unavailable } from "@getpaseo/plugin/server/usage";
import type { UsageAccount, UsageReport, UsageDetail } from "@getpaseo/plugin/server/usage";
import type { Input } from "../shared/input.js";
import { providerLabels, quotaReport } from "./quota.js";

const origin = "http://127.0.0.1:20128";
const accountSchema = z.object({
  id: z.string().min(1).max(512),
  provider: z.string().min(1),
  name: z.string().nullish(),
  email: z.string().nullish(),
  isActive: z.boolean(),
  testStatus: z.string().nullish(),
});
const listingSchema = z.object({
  connections: z.array(accountSchema),
  pagination: z.object({ totalPages: z.number().int().nonnegative() }).optional(),
});

async function request(route: string, dataDir: string, fetchApi: typeof fetch): Promise<Response> {
  let machineId: string;
  let secret: string;
  try {
    [machineId, secret] = await Promise.all([
      readFile(join(dataDir, "machine-id"), "utf8"),
      readFile(join(dataDir, "auth", "cli-secret"), "utf8"),
    ]);
  } catch {
    throw new Error("9router local CLI authentication is unavailable.");
  }
  if (!machineId.trim() || !secret.trim())
    throw new Error("9router local CLI authentication is empty.");
  // This is 9router's machine-local CLI authentication contract, not a provider/API key.
  // Keep it only on the daemon and never follow redirects with this privileged header.
  const token = createHash("sha256")
    .update(machineId.trim())
    .update("9r-cli-auth")
    .update(secret.trim())
    .digest("hex")
    .slice(0, 16);
  return fetchApi(`${origin}${route}`, {
    method: "GET",
    headers: { "x-9r-cli-token": token, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
}

export async function discover(
  dataDir = join(homedir(), ".9router"),
  fetchApi: typeof fetch = fetch,
): Promise<UsageAccount[]> {
  if (!existsSync(join(dataDir, "machine-id")) || !existsSync(join(dataDir, "auth", "cli-secret")))
    return [];
  const accounts: UsageAccount[] = [];
  const seen = new Set<string>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    // The dashboard's client endpoint excludes provider credential blobs.
    const response = await request(
      `/api/providers/client?page=${page}&pageSize=100&accountStatus=all&sort=priority`,
      dataDir,
      fetchApi,
    );
    if (!response.ok) throw new Error(`9router account listing returned HTTP ${response.status}.`);
    const listing = listingSchema.parse(await response.json());
    totalPages = listing.pagination?.totalPages ?? 1;
    for (const account of listing.connections) {
      if (seen.has(account.id)) continue;
      seen.add(account.id);
      accounts.push({
        key: hashAccountKey(account.id),
        label:
          account.email ||
          account.name ||
          `${providerLabels[account.provider] || account.provider} · ${account.id.slice(0, 8)}`,
        input: {
          dataDir,
          connectionId: account.id,
          provider: account.provider,
          enabled: account.isActive,
          status: account.testStatus || "unknown",
        },
      });
    }
  }
  return accounts;
}

export async function fetchUsage(
  input: Input,
  fetchApi: typeof fetch = fetch,
): Promise<UsageReport> {
  // Use the same read-only, cached quota endpoint as Quota Tracker. No reset, ping or credit-spending actions.
  const response = await request(
    `/api/usage/${encodeURIComponent(input.connectionId)}`,
    input.dataDir,
    fetchApi,
  );
  if (response.status === 401 || response.status === 403) {
    return unavailable({ kind: "rejected", status: response.status, refreshedBy: "9router" });
  }
  if (!response.ok) throw new Error(`9router account quota returned HTTP ${response.status}.`);
  const report = quotaReport(input.provider, await response.json());
  if (report.status === "available") {
    report.details ??= [];
    let tone: UsageDetail["tone"] = "default";
    if (!input.enabled) tone = "warning";
    else if (/unavailable|error|invalid|expired/i.test(input.status)) tone = "danger";
    report.details.push({
      id: "account_status",
      label: "9router account status",
      value: input.enabled ? input.status : "Disabled",
      tone,
    });
  }
  return report;
}

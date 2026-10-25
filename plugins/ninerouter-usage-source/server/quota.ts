import { z } from "zod";
import { unavailable, windowFromUsedPct } from "@getpaseo/plugin/server/usage";
import type { UsageDetail, UsageReport, UsageWindow } from "@getpaseo/plugin/server/usage";

export const providerLabels: Record<string, string> = {
  antigravity: "Antigravity",
  claude: "Claude Code",
  codex: "OpenAI Codex",
  kiro: "Kiro AI",
};
const quotaSchema = z.object({
  used: z.number().finite().nonnegative().nullish(),
  total: z.number().finite().nonnegative().nullish(),
  remaining: z.number().finite().nullish(),
  remainingPercentage: z.number().finite().min(0).max(100).nullish(),
  resetAt: z.iso.datetime({ offset: true }).nullish(),
  unlimited: z.boolean().optional(),
  displayName: z.string().optional(),
});
const responseSchema = z.object({
  plan: z.string().nullish(),
  quotas: z.record(z.string(), quotaSchema).default({}),
});
type Quota = z.infer<typeof quotaSchema>;
type QuotaEntry = [string, Quota];
const families = [
  ["gemini", "gemini-", "gemini_session", "gemini_weekly", "Gemini (Flash / Pro)"],
  ["claude", "claude-", "claude_gpt_session", "claude_gpt_weekly", "Claude (Sonnet / Opus)"],
] as const;
const codexLabels: Record<string, string> = {
  session: "5h",
  weekly: "Weekly",
  spark_session: "Spark (5h)",
  spark_weekly: "Spark (Weekly)",
  review_session: "Review (5h)",
  review_weekly: "Review (Weekly)",
};
const numbers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function remainingPercent(quota: Quota): number | null {
  if (quota.unlimited) return null;
  if (quota.remainingPercentage != null) return quota.remainingPercentage;
  if (quota.total == null || quota.total <= 0) return null;
  const remaining = quota.remaining ?? (quota.used == null ? null : quota.total - quota.used);
  if (remaining == null) return null;
  return Math.max(0, Math.min(100, (remaining / quota.total) * 100));
}

function mostConstrainedModel(entries: QuotaEntry[], prefix: string): Quota | undefined {
  let worst: Quota | undefined;
  for (const [key, quota] of entries) {
    if (!key.startsWith(prefix) || key.includes("image")) continue;
    if (!worst || (remainingPercent(quota) ?? Infinity) < (remainingPercent(worst) ?? Infinity))
      worst = quota;
  }
  return worst;
}

function remainingTone(remaining: number | null): UsageWindow["tone"] {
  if (remaining === null) return "default";
  const shown = Math.round(remaining);
  if (shown > 70) return "ok";
  if (shown >= 30) return "warning";
  return "danger";
}

/** The tracker groups shared Antigravity model budgets rather than showing duplicates per model. */
function antigravityEntries(quotas: Record<string, Quota>): QuotaEntry[] {
  const entries = Object.entries(quotas);
  const selected: QuotaEntry[] = [];
  for (const [id, prefix, sessionKey, weeklyKey, label] of families) {
    const session = quotas[sessionKey];
    const weekly = quotas[weeklyKey];
    if (session) selected.push([sessionKey, session]);
    else {
      const worst = mostConstrainedModel(entries, prefix);
      // A model blocked by the reported weekly reset is not a separate 5-hour budget.
      if (worst && !(weekly && remainingPercent(worst) === 0 && worst.resetAt === weekly.resetAt)) {
        selected.push([id, { ...worst, displayName: label }]);
      }
    }
    if (weekly) selected.push([weeklyKey, weekly]);
  }
  for (const [key, quota] of entries) {
    if (key.includes("image")) selected.push([key, quota]);
    else if (
      !quotas.claude_gpt_session &&
      !quotas.claude_gpt_weekly &&
      !key.startsWith("gemini-") &&
      !key.startsWith("claude-") &&
      !families.some(([, , session, weekly]) => key === session || key === weekly)
    )
      selected.push([key, quota]);
  }
  return selected;
}

export function quotaReport(provider: string, payload: unknown): UsageReport {
  const data = responseSchema.parse(payload);
  const entries =
    provider === "antigravity" ? antigravityEntries(data.quotas) : Object.entries(data.quotas);
  if (entries.length === 0)
    return unavailable({
      kind: "no_quota",
      detail: "9router reported no quota windows for this account.",
    });
  const windows: UsageWindow[] = [];
  const details: UsageDetail[] = [];
  for (const [id, quota] of entries) {
    const label = quota.displayName || (provider === "codex" ? codexLabels[id] : undefined) || id;
    const remaining = remainingPercent(quota);
    const tone = remainingTone(remaining);
    windows.push(
      windowFromUsedPct({
        id,
        label,
        utilizationPct: remaining === null ? null : 100 - remaining,
        resetsAt: quota.resetAt,
        tone,
      }),
    );
    if (quota.unlimited) details.push({ id: `${id}:limit`, label, value: "Unlimited" });
    else if (quota.used != null && quota.total != null) {
      details.push({
        id: `${id}:counts`,
        label: `${label} used / total`,
        value: `${numbers.format(quota.used)} / ${numbers.format(quota.total)}`,
      });
    }
  }
  const providerLabel = providerLabels[provider] || provider;
  return {
    status: "available",
    planLabel:
      data.plan && data.plan !== providerLabel ? `${providerLabel} · ${data.plan}` : providerLabel,
    windows,
    details,
  };
}

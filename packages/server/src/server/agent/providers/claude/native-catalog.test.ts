import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: () => {
    throw new Error("Process execution is forbidden in native catalog tests");
  },
  spawnSync: () => {
    throw new Error("Process execution is forbidden in native catalog tests");
  },
  exec: () => {
    throw new Error("Process execution is forbidden in native catalog tests");
  },
  execFile: () => {
    throw new Error("Process execution is forbidden in native catalog tests");
  },
}));

import {
  ClaudeNativeCatalogError,
  findClaudeNativeModel,
  readClaudeNativeCatalog,
  resolveClaudeNativeModelId,
} from "./native-catalog.js";

// Synthetic account metadata, never copied from a user's account or credentials.
const accountUuid = "00000000-0000-4000-8000-000000000001";
const organizationUuid = "00000000-0000-4000-8000-000000000002";
const roots: string[] = [];
const ids = [
  "claude-opus-5-5",
  "claude-fable-5-2",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-fable-5-1",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
];
function fixtureThinking(index: number) {
  if (index === 5) return { type: "none" };
  const efforts = ["low", "medium", "high", ...(index < 11 ? ["xhigh"] : []), "max"];
  const effort_options = efforts.map((effort) => ({
    id: effort,
    name: effort === "xhigh" ? "Extra" : effort[0]!.toUpperCase() + effort.slice(1),
  }));
  return { type: "effort", effort_options };
}

function fixture() {
  return {
    version: 2,
    fetchedAt: 1700000000000,
    staleAt: 1700003600000,
    catalog: {
      surface: "cc",
      config: {
        id: "cc",
        models: ids.map((id, index) => ({
          id,
          name: [
            "Opus 5.5",
            "Fable 5.2",
            "Sonnet 5.5",
            "Haiku 5.5",
            "Fable 5.1",
            "Haiku 4.5",
            "Sonnet 5",
            "Opus 5",
            "Fable 5",
            "Opus 4.8",
            "Opus 4.7",
            "Opus 4.6",
            "Sonnet 4.6",
          ][index],
          section: index < 4 ? "main" : "overflow",
          thinking: fixtureThinking(index),
          runtime: {
            max_input_tokens: index === 5 ? 200000 : 1000000,
            max_output_tokens: index === 5 ? 64000 : 128000,
            ...(index === 5
              ? {}
              : {
                  default_effort: [
                    "medium",
                    "medium",
                    "medium",
                    "medium",
                    "high",
                    "",
                    "high",
                    "high",
                    "high",
                    "high",
                    "xhigh",
                    "high",
                    "high",
                  ][index],
                }),
            capabilities:
              index === 1 ? ["rejects_disabled_thinking", "per_turn_effort"] : ["mm_images"],
          },
          ...(index === 1
            ? {
                fast_mode: {
                  type: "toggle",
                  options: [
                    { id: "fast", name: "Enable fast mode" },
                    { id: "off", name: "Off" },
                  ],
                },
              }
            : {}),
        })),
        provider_alias_targets: {
          opus: { default: ids[0] },
          fable: { default: ids[1] },
          sonnet: { default: ids[2] },
          haiku: { default: ids[3] },
        },
      },
      state: { id: "cc", model: ids[0], thinking: { type: "effort", effort: "medium" } },
    },
  };
}
async function setup(value: unknown = fixture()) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-native-catalog-"));
  roots.push(configDir);
  const scope = createHash("sha256").update(accountUuid).digest("hex").slice(0, 12);
  const cacheDir = path.join(configDir, "cache", "model-catalog");
  const cachePath = path.join(cacheDir, `${organizationUuid}-${scope}-cc.json`);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, ".claude.json"),
    JSON.stringify({
      oauthAccount: { accountUuid, organizationUuid },
      cachedGrowthBookFeatures: { tengu_delegated_quail: { served: "primary" } },
    }),
  );
  await fs.writeFile(path.join(configDir, "settings.json"), JSON.stringify({ model: "opus" }));
  await fs.writeFile(cachePath, JSON.stringify(value));
  return { configDir, cachePath, cacheDir };
}
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is forbidden in native catalog tests");
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("native Claude disk catalog", () => {
  it("keeps all thirteen rows, native labels, aliases, limits and thinking defaults", async () => {
    const { configDir } = await setup();
    const catalog = await readClaudeNativeCatalog({ configDir, env: {}, now: 1700000000001 });
    expect(catalog.models.map((model) => model.id)).toEqual(ids);
    expect(catalog.models.filter((model) => model.isDefault).map((model) => model.id)).toEqual([
      ids[0],
    ]);
    expect(catalog.selectedModelId).toBe(ids[0]);
    expect(resolveClaudeNativeModelId(catalog, "FABLE")).toBe(ids[1]);
    expect(resolveClaudeNativeModelId(catalog, null)).toBe(ids[0]);
    expect(findClaudeNativeModel(catalog, "fable")?.label).toBe("Fable 5.2");
    expect(
      findClaudeNativeModel(catalog, "fable")?.thinkingOptions?.map((option) => option.id),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(
      findClaudeNativeModel(catalog, "opus")?.thinkingOptions?.find(
        (option) => option.id === "xhigh",
      )?.label,
    ).toBe("Extra");
    expect(findClaudeNativeModel(catalog, "opus")?.defaultThinkingOptionId).toBe("medium");
    expect(findClaudeNativeModel(catalog, ids[5])?.thinkingOptions).toBeUndefined();
    expect(findClaudeNativeModel(catalog, ids[5])?.contextWindowMaxTokens).toBe(200000);
    expect(catalog.rows.get(ids[1]!)?.runtime?.max_output_tokens).toBe(128000);
    expect(catalog.rows.get(ids[1]!)?.fast_mode?.options?.[0]?.id).toBe("fast");
    expect(catalog.stale).toBe(false);
    expect(resolveClaudeNativeModelId(catalog, "not-advertised")).toBeUndefined();
  });
  it("serves a marked stale snapshot and observes native cache replacements without a refresh", async () => {
    const { configDir, cachePath } = await setup();
    const old = await readClaudeNativeCatalog({ configDir, env: {}, now: 1700003600001 });
    expect(old.stale).toBe(true);
    const replacement = fixture();
    replacement.catalog.config.models[1]!.name = "Updated native label";
    await fs.writeFile(cachePath, JSON.stringify(replacement));
    const next = await readClaudeNativeCatalog({ configDir, env: {} });
    expect(next.cacheKey).not.toBe(old.cacheKey);
    expect(next.models[1]?.label).toBe("Updated native label");
  });
  it("does not borrow a different account's newer catalog", async () => {
    const { configDir, cachePath, cacheDir } = await setup();
    await fs.rename(cachePath, path.join(cacheDir, "another-account-cc.json"));
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "cache-missing",
    });
  });
  it("derives profile metadata and cache solely inside CLAUDE_CONFIG_DIR", async () => {
    const { configDir } = await setup();
    expect(
      (await readClaudeNativeCatalog({ env: { CLAUDE_CONFIG_DIR: configDir } })).models,
    ).toHaveLength(13);
  });
  it.each([null, { version: 1 }, { ...fixture(), catalog: { surface: "ccd" } }])(
    "rejects unusable cache data without a static fallback: %j",
    async (value) => {
      const { configDir } = await setup(value);
      await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toBeInstanceOf(
        ClaudeNativeCatalogError,
      );
    },
  );
  it("rejects malformed and oversized native files", async () => {
    const { configDir, cachePath } = await setup();
    await fs.writeFile(cachePath, "{");
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "cache-invalid",
    });
    await fs.writeFile(cachePath, " ".repeat(2 * 1024 * 1024 + 4097));
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "cache-invalid",
    });
  });
  it("keeps stable section order, removes duplicates/deprecated rows and retains disabled state", async () => {
    const value = fixture();
    const overflow = value.catalog.config.models.splice(4, 1)[0]!;
    value.catalog.config.models.unshift(overflow);
    value.catalog.config.models.push({
      ...value.catalog.config.models[1]!,
      section: "deprecated",
      id: "retired",
    });
    value.catalog.config.models.push({ ...value.catalog.config.models[1]! });
    Object.assign(value.catalog.config.models[1]!, { disabled: true });
    const { configDir } = await setup(value);
    const catalog = await readClaudeNativeCatalog({ configDir, env: {} });
    expect(catalog.models.map((model) => model.id)).toEqual(ids);
    expect(catalog.models[0]?.isSelectable).toBe(false);
  });
  it("accepts future advertised IDs and literal choices rather than intersecting a static manifest", async () => {
    const value = fixture();
    value.catalog.config.models[1]!.id = "claude-future-12";
    value.catalog.config.models[1]!.name = "Future twelve";
    value.catalog.config.provider_alias_targets.fable.default = "claude-future-12";
    const { configDir } = await setup(value);
    expect(
      findClaudeNativeModel(await readClaudeNativeCatalog({ configDir, env: {} }), "fable")?.id,
    ).toBe("claude-future-12");
  });
  it("reports unsupported custom model policy instead of inventing capabilities", async () => {
    const { configDir } = await setup();
    await fs.writeFile(
      path.join(configDir, "settings.json"),
      JSON.stringify({ model: "unadvertised-model" }),
    );
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "unsupported-configuration",
    });
    await fs.writeFile(
      path.join(configDir, "settings.json"),
      JSON.stringify({ availableModels: ["opus"] }),
    );
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "unsupported-configuration",
    });
  });
  it("honors explicit version metadata without executing a version command", async () => {
    const value = fixture();
    Object.assign(value.catalog.config.models[1]!, { min_claude_code_version: "99.0.0" });
    const { configDir } = await setup(value);
    expect(
      (
        await readClaudeNativeCatalog({ configDir, env: {}, claudeCodeVersion: "2.1.311" })
      ).models.map((model) => model.id),
    ).not.toContain(ids[1]);
  });
  it("rejects new thinking mode controls instead of silently dropping part of the native UI", async () => {
    const value = fixture();
    Object.assign(value.catalog.config.models[1]!.thinking, {
      type: "effort_and_mode",
      mode_options: [{ id: "auto", name: "Auto" }],
    });
    const { configDir } = await setup(value);
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "unsupported-configuration",
    });
  });
  it("re-derives account identity when metadata changes and never retains the previous account snapshot", async () => {
    const { configDir } = await setup();
    const previous = await readClaudeNativeCatalog({ configDir, env: {} });
    expect(previous.models).toHaveLength(13);
    await fs.writeFile(
      path.join(configDir, ".claude.json"),
      JSON.stringify({
        oauthAccount: { accountUuid: "00000000-0000-4000-8000-000000000003", organizationUuid },
      }),
    );
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "cache-missing",
    });
  });
  it("fails identity resolution rather than scanning caches when account metadata disappears", async () => {
    const { configDir } = await setup();
    await fs.unlink(path.join(configDir, ".claude.json"));
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "identity-unavailable",
    });
  });
  it("rejects credential/profile overrides without reading credential storage", async () => {
    const { configDir } = await setup();
    await expect(
      readClaudeNativeCatalog({ configDir, env: { ANTHROPIC_API_KEY: "synthetic-test-value" } }),
    ).rejects.toMatchObject({ code: "unsupported-configuration" });
  });
  it("honors caller cancellation before reading the catalog", async () => {
    const { configDir } = await setup();
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));
    await expect(
      readClaudeNativeCatalog({ configDir, env: {}, signal: controller.signal }),
    ).rejects.toThrow("cancelled by test");
  });
  it("reads a versioned installation symlink without executing the target", async () => {
    const value = fixture();
    Object.assign(value.catalog.config.models[1]!, { min_claude_code_version: "3.0.0" });
    const { configDir } = await setup(value);
    const binaryDirectory = path.join(configDir, "installation", "2.1.311");
    const binDirectory = path.join(configDir, "bin");
    await fs.mkdir(binaryDirectory, { recursive: true });
    await fs.mkdir(binDirectory);
    const executablePath = path.join(
      binDirectory,
      process.platform === "win32" ? "claude.exe" : "claude",
    );
    await fs.writeFile(path.join(binaryDirectory, "claude"), "This is data, not an executable.");
    await fs.symlink(path.join(binaryDirectory, "claude"), executablePath);
    const catalog = await readClaudeNativeCatalog({ configDir, env: { PATH: binDirectory } });
    expect(catalog.models.map((model) => model.id)).not.toContain(ids[1]);
  });
  it("does not guess installation versions when a row requires a newer Claude", async () => {
    const value = fixture();
    Object.assign(value.catalog.config.models[1]!, { min_claude_code_version: "3.0.0" });
    const { configDir } = await setup(value);
    await expect(readClaudeNativeCatalog({ configDir, env: {} })).rejects.toMatchObject({
      code: "unsupported-configuration",
    });
  });
  it("never synthesizes off or budget choices absent from the native catalog", async () => {
    const { configDir } = await setup();
    const catalog = await readClaudeNativeCatalog({ configDir, env: {} });
    for (const model of catalog.models) {
      const choices = model.thinkingOptions?.map((option) => option.id) ?? [];
      expect(choices).not.toContain("off");
      expect(choices).not.toContain("budget");
    }
  });
});

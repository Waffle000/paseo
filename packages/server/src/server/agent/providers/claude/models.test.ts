import { describe, expect, it } from "vitest";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import { buildClaudeFeatures, claudeModelSupportsFastMode } from "./feature-definitions.js";
import {
  findClaudeModel,
  getClaudeContextWindowMaxTokens,
  normalizeClaudeRuntimeModelId,
  resolveObservedClaudeModelId,
} from "./models.js";
import type { ClaudeNativeCatalog, ClaudeNativeModelRow } from "./native-catalog.js";

function snapshot(
  input: {
    cacheKey?: string;
    models?: AgentModelDefinition[];
    aliases?: Record<string, string>;
    rows?: Array<[string, ClaudeNativeModelRow]>;
  } = {},
): ClaudeNativeCatalog {
  return {
    cacheKey: input.cacheKey ?? "config-profile-a",
    models: input.models ?? [],
    defaultModelId: input.models?.find((model) => model.isDefault)?.id,
    selectedModelId: input.models?.[0]?.id,
    surface: "cc",
    fetchedAt: 1_795_132_800_000,
    staleAt: 1_795_136_400_000,
    stale: false,
    state: {},
    providerAliasTargets: {},
    settingsVocabulary: {},
    aliases: input.aliases ?? {},
    rows: new Map<string, ClaudeNativeModelRow>(
      input.rows ??
        input.models?.map((model): [string, ClaudeNativeModelRow] => [
          model.id,
          { id: model.id },
        ]) ??
        [],
    ),
  };
}

function nativeRow(
  id: string,
  options?: Array<{ id: string; name?: string }>,
): ClaudeNativeModelRow {
  return {
    id,
    ...(options ? { fast_mode: { options } } : {}),
  };
}

const futureModel: AgentModelDefinition = {
  provider: "claude",
  id: "claude-future-9",
  label: "Native future model",
  description: "Profile-specific description",
  isDefault: true,
  contextWindowMaxTokens: 640_000,
  thinkingOptions: [
    { id: "deliberate", label: "Native deliberate", isDefault: true },
    { id: "brief", label: "Native brief" },
  ],
  defaultThinkingOptionId: "deliberate",
};

function futureSnapshot(): ClaudeNativeCatalog {
  return snapshot({
    models: [futureModel],
    aliases: {
      "native-choice": futureModel.id,
      "claude-future-9-20261120": futureModel.id,
    },
  });
}

describe("findClaudeModel", () => {
  it("uses the explicit snapshot's model metadata without a curated catalog", () => {
    const catalog = futureSnapshot();

    expect(findClaudeModel(catalog, futureModel.id)).toEqual(futureModel);
    expect(findClaudeModel(catalog, "native-choice")).toEqual(futureModel);
    expect(findClaudeModel(catalog, "claude-future-9-20261120")).toEqual(futureModel);
  });

  it.each([
    "future",
    "Native future model",
    "claude-future-9[1m]",
    "claude-future-9-20261201",
    "anthropic/claude-future-9",
    "us.anthropic.claude-future-9-v1:0",
    "claude-opus-5-5",
  ])("does not invent a snapshot alias for %s", (id) => {
    expect(findClaudeModel(futureSnapshot(), id)).toBeUndefined();
  });

  it("has no fallback when a snapshot or its models are absent", () => {
    expect(findClaudeModel(undefined, futureModel.id)).toBeUndefined();
    expect(findClaudeModel(snapshot(), "claude-opus-5-5")).toBeUndefined();
  });

  it.each(["", "   "])("omits an empty model identity: %s", (id) => {
    expect(findClaudeModel(futureSnapshot(), id)).toBeUndefined();
  });

  it.each([null, undefined, "default"])("uses the snapshot default for %s", (id) => {
    expect(findClaudeModel(futureSnapshot(), id)).toEqual(futureModel);
    expect(findClaudeModel(snapshot(), id)).toBeUndefined();
  });

  it("keeps aliases and metadata isolated between config-profile snapshots", () => {
    const profileA = futureSnapshot();
    const profileBModel: AgentModelDefinition = {
      provider: "claude",
      id: "private/profile-b",
      label: "Profile B model",
      contextWindowMaxTokens: 96_000,
    };
    const profileB = snapshot({
      cacheKey: "config-profile-b",
      models: [profileBModel],
      aliases: { "native-choice": profileBModel.id },
    });

    expect(findClaudeModel(profileA, "native-choice")).toEqual(futureModel);
    expect(findClaudeModel(profileB, "native-choice")).toEqual(profileBModel);
    expect(findClaudeModel(profileA, profileBModel.id)).toBeUndefined();
    expect(findClaudeModel(profileB, futureModel.id)).toBeUndefined();
    expect(findClaudeModel(profileA, "native-choice")).toEqual(futureModel);
    expect(getClaudeContextWindowMaxTokens(profileA, "native-choice")).toBe(640_000);
    expect(getClaudeContextWindowMaxTokens(profileB, "native-choice")).toBe(96_000);
  });
});

describe("getClaudeContextWindowMaxTokens", () => {
  it("returns only the snapshot's declared context window, including through aliases", () => {
    const catalog = futureSnapshot();

    expect(getClaudeContextWindowMaxTokens(catalog, futureModel.id)).toBe(640_000);
    expect(getClaudeContextWindowMaxTokens(catalog, "native-choice")).toBe(640_000);
  });

  it("does not infer a limit from an unknown or metadata-free [1m] identity", () => {
    const catalog = snapshot({
      models: [{ provider: "claude", id: "private/model[1m]", label: "No declared context" }],
    });

    expect(getClaudeContextWindowMaxTokens(catalog, "private/model[1m]")).toBeUndefined();
    expect(getClaudeContextWindowMaxTokens(catalog, "glm-future[1m]")).toBeUndefined();
    expect(getClaudeContextWindowMaxTokens(catalog, "glm-future[1M]")).toBeUndefined();
    expect(getClaudeContextWindowMaxTokens(undefined, "claude-opus-5-5[1m]")).toBeUndefined();
  });

  it("preserves a native context limit even when the ID contains [1m]", () => {
    const catalog = snapshot({
      models: [
        {
          provider: "claude",
          id: "private/model[1m]",
          label: "Native limit",
          contextWindowMaxTokens: 320_000,
        },
      ],
    });

    expect(getClaudeContextWindowMaxTokens(catalog, "private/model[1m]")).toBe(320_000);
  });
});

describe("normalizeClaudeRuntimeModelId", () => {
  it("resolves only aliases supplied by the current snapshot", () => {
    const catalog = futureSnapshot();

    expect(normalizeClaudeRuntimeModelId(catalog, futureModel.id)).toBe(futureModel.id);
    expect(normalizeClaudeRuntimeModelId(catalog, " native-choice ")).toBe(futureModel.id);
    expect(normalizeClaudeRuntimeModelId(catalog, "claude-future-9-20261120")).toBe(futureModel.id);
    expect(normalizeClaudeRuntimeModelId(undefined, "native-choice")).toBe("native-choice");
    expect(normalizeClaudeRuntimeModelId(snapshot(), "native-choice")).toBe("native-choice");
  });

  it.each([
    "claude-future-10",
    "claude-future-9-20261201",
    "claude-future-9[1m]",
    "openrouter/anthropic/claude-future-9",
    "us.anthropic.claude-future-9-v1:0",
    "gpt-future",
    "custom-deployment",
  ])("preserves unadvertised runtime identity %s", (id) => {
    expect(normalizeClaudeRuntimeModelId(futureSnapshot(), ` ${id} `)).toBe(id);
    expect(normalizeClaudeRuntimeModelId(undefined, ` ${id} `)).toBe(id);
  });

  it.each([null, undefined, "", "   "])("omits an empty runtime identity: %s", (id) => {
    expect(normalizeClaudeRuntimeModelId(futureSnapshot(), id)).toBeNull();
    expect(normalizeClaudeRuntimeModelId(undefined, id)).toBeNull();
  });
});

describe("resolveObservedClaudeModelId", () => {
  it.each([
    "native-choice",
    "claude-future-9-20261120",
    "claude-future-9[1m]",
    "openrouter/anthropic/claude-future-9",
    "private/future-model",
  ])("retains the raw observed identity %s rather than canonicalizing it", (id) => {
    expect(resolveObservedClaudeModelId(` ${id} `)).toBe(id);
  });

  it.each([null, undefined, "", "   ", "<synthetic>", " <synthetic> "])(
    "omits non-inference identity %s",
    (id) => {
      expect(resolveObservedClaudeModelId(id)).toBeNull();
    },
  );
});

describe("claudeModelSupportsFastMode", () => {
  it("uses the canonical native row's fast option, including for custom models", () => {
    const id = "private/future-model";
    const catalog = snapshot({
      models: [{ provider: "claude", id, label: "Custom model" }],
      aliases: { "native-fast-choice": id },
      rows: [[id, nativeRow(id, [{ id: "normal" }, { id: "fast" }])]],
    });

    expect(claudeModelSupportsFastMode(catalog, id)).toBe(true);
    expect(claudeModelSupportsFastMode(catalog, "native-fast-choice")).toBe(true);
    expect(claudeModelSupportsFastMode(catalog, "private/future-model-20261120")).toBe(false);
  });

  it.each([
    nativeRow("claude-opus-5-5"),
    nativeRow("claude-opus-5-5", []),
    nativeRow("claude-opus-5-5", [{ id: "normal", name: "fast" }]),
    nativeRow("claude-opus-5-5", [{ id: "fastest" }]),
  ])("does not guess Opus support without an exact fast option", (row) => {
    const catalog = snapshot({
      models: [{ provider: "claude", id: "claude-opus-5-5", label: "Opus" }],
      rows: [["claude-opus-5-5", row]],
    });

    expect(claudeModelSupportsFastMode(catalog, "claude-opus-5-5")).toBe(false);
  });

  it("does not use an alias row instead of the canonical row", () => {
    const catalog = snapshot({
      models: [futureModel],
      aliases: { "native-choice": futureModel.id },
      rows: [
        [futureModel.id, nativeRow(futureModel.id, [{ id: "normal" }])],
        ["native-choice", nativeRow("native-choice", [{ id: "fast" }])],
      ],
    });

    expect(claudeModelSupportsFastMode(catalog, "native-choice")).toBe(false);
  });

  it("does not grant support when the catalog or native row is absent", () => {
    expect(claudeModelSupportsFastMode(undefined, "claude-opus-5-5")).toBe(false);
    const noRows = snapshot({ models: [futureModel], rows: [] });
    expect(claudeModelSupportsFastMode(noRows, futureModel.id)).toBe(false);
    expect(claudeModelSupportsFastMode(snapshot(), "claude-opus-5-5")).toBe(false);
    expect(claudeModelSupportsFastMode(futureSnapshot(), null)).toBe(false);
  });

  it("keeps capability rows isolated between config profiles", () => {
    const profileA = snapshot({
      models: [futureModel],
      rows: [[futureModel.id, nativeRow(futureModel.id, [{ id: "fast" }])]],
    });
    const profileB = snapshot({
      cacheKey: "config-profile-b",
      models: [futureModel],
      rows: [[futureModel.id, nativeRow(futureModel.id, [{ id: "normal" }])]],
    });

    expect(claudeModelSupportsFastMode(profileA, futureModel.id)).toBe(true);
    expect(claudeModelSupportsFastMode(profileB, futureModel.id)).toBe(false);
    expect(claudeModelSupportsFastMode(profileA, futureModel.id)).toBe(true);
  });
});

describe("buildClaudeFeatures", () => {
  it.each([false, true])("preserves the fast-mode toggle value %s for a supported row", (value) => {
    const catalog = snapshot({
      models: [futureModel],
      aliases: { "native-choice": futureModel.id },
      rows: [[futureModel.id, nativeRow(futureModel.id, [{ id: "fast" }])]],
    });

    const features = buildClaudeFeatures({
      catalog,
      modelId: "native-choice",
      fastModeEnabled: value,
    });

    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ type: "toggle", id: "fast_mode", value });
  });

  it("omits the toggle without advertised support even when fast mode was enabled", () => {
    expect(
      buildClaudeFeatures({
        catalog: futureSnapshot(),
        modelId: futureModel.id,
        fastModeEnabled: true,
      }),
    ).toEqual([]);
    expect(
      buildClaudeFeatures({
        modelId: "claude-opus-5-5",
        fastModeEnabled: true,
      }),
    ).toEqual([]);
  });
});

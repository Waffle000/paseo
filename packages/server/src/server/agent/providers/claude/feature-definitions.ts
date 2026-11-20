import type { AgentFeature, AgentFeatureToggle } from "../../agent-sdk-types.js";
import { findClaudeNativeModel, type ClaudeNativeCatalog } from "./native-catalog.js";

export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency Opus responses at higher token cost",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

export function claudeModelSupportsFastMode(
  catalog: ClaudeNativeCatalog | undefined,
  modelId: string | null | undefined,
): boolean {
  const model = catalog && findClaudeNativeModel(catalog, modelId);
  return (
    !!model &&
    catalog?.rows.get(model.id)?.fast_mode?.options?.some((option) => option.id === "fast") === true
  );
}

export function buildClaudeFeatures(input: {
  catalog?: ClaudeNativeCatalog;
  modelId: string | null | undefined;
  fastModeEnabled: boolean;
}): AgentFeature[] {
  if (!claudeModelSupportsFastMode(input.catalog, input.modelId)) {
    return [];
  }

  return [
    {
      ...CLAUDE_FAST_MODE_FEATURE,
      value: input.fastModeEnabled,
    },
  ];
}

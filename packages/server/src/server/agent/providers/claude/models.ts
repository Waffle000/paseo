import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import {
  findClaudeNativeModel,
  resolveClaudeNativeModelId,
  type ClaudeNativeCatalog,
} from "./native-catalog.js";

export function findClaudeModel(
  catalog: ClaudeNativeCatalog | undefined,
  modelId: string | null | undefined,
): AgentModelDefinition | undefined {
  return catalog ? findClaudeNativeModel(catalog, modelId) : undefined;
}

export function getClaudeContextWindowMaxTokens(
  catalog: ClaudeNativeCatalog | undefined,
  modelId: string | null | undefined,
): number | undefined {
  return findClaudeModel(catalog, modelId)?.contextWindowMaxTokens;
}

/** Native aliases are authoritative; an unrecognized future or custom ID stays intact. */
export function normalizeClaudeRuntimeModelId(
  catalog: ClaudeNativeCatalog | undefined,
  value: string | null | undefined,
): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  return (catalog ? resolveClaudeNativeModelId(catalog, trimmed) : undefined) ?? trimmed;
}

/** Frames without inference use a placeholder, not an actual model identity. */
export function resolveObservedClaudeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed !== "<synthetic>" ? trimmed : null;
}

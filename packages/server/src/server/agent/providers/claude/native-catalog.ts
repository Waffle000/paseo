import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { AgentModelDefinition, AgentSelectOption } from "../../agent-sdk-types.js";

type JsonObject = Record<string, unknown>;
export interface ClaudeNativeOption extends JsonObject {
  id?: string;
  name?: string;
  description?: string;
}
export interface ClaudeNativeModelRow extends JsonObject {
  id: string;
  name?: string;
  description?: string;
  section?: string;
  disabled?: boolean;
  confidential?: boolean;
  min_claude_code_version?: string;
  offered_on?: string[] | null;
  thinking?: {
    type?: string;
    effort_options?: ClaudeNativeOption[];
    mode_options?: ClaudeNativeOption[];
    always_on?: boolean;
    [key: string]: unknown;
  };
  fast_mode?: {
    type?: string;
    options?: ClaudeNativeOption[];
    [key: string]: unknown;
  };
  runtime?: {
    max_input_tokens?: number;
    max_output_tokens?: number;
    default_output_tokens?: number;
    effort_levels?: string[];
    default_effort?: string;
    capabilities?: string[];
    family?: string;
    [key: string]: unknown;
  };
}
export interface ClaudeNativeCatalog {
  models: AgentModelDefinition[];
  cacheKey: string;
  defaultModelId?: string;
  selectedModelId?: string;
  surface: "cc" | "ccr" | "ccd";
  fetchedAt: number;
  staleAt: number;
  stale: boolean;
  state: JsonObject;
  providerAliasTargets: JsonObject;
  settingsVocabulary: JsonObject;
  aliases: Record<string, string>;
  rows: ReadonlyMap<string, ClaudeNativeModelRow>;
}
export class ClaudeNativeCatalogError extends Error {
  constructor(
    public readonly code:
      | "identity-unavailable"
      | "cache-missing"
      | "cache-invalid"
      | "surface-not-served"
      | "unsupported-configuration",
    message: string,
  ) {
    super(message);
    this.name = "ClaudeNativeCatalogError";
  }
}
export interface ReadClaudeNativeCatalogOptions {
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  claudeCodeVersion?: string;
  claudeExecutablePath?: string;
  now?: number;
}
const MAX_CACHE_BYTES = 2 * 1024 * 1024 + 4096;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalize = (value: string): string => value.trim().toLowerCase();
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const flag = (value: unknown): boolean => value === "1" || value === "true" || value === true;

async function readJson(
  file: string,
  limit: number,
  signal?: AbortSignal,
  optional = false,
): Promise<unknown> {
  let handle: fs.FileHandle | undefined;
  try {
    signal?.throwIfAborted();
    handle = await fs.open(file, "r");
    const size = (await handle.stat()).size;
    if (size > limit) throw new Error("oversized");
    const bytes = Buffer.alloc(size + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const chunk = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    signal?.throwIfAborted();
    if (bytesRead > limit) throw new Error("oversized");
    return JSON.parse(bytes.toString("utf8", 0, bytesRead));
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (object(error) && error.code === "ENOENT") {
      if (optional) return undefined;
      throw new ClaudeNativeCatalogError(
        "cache-missing",
        "Claude Code has not written a model catalog for this account and surface.",
      );
    }
    throw new ClaudeNativeCatalogError(
      "cache-invalid",
      "Claude Code model catalog metadata is unreadable or malformed.",
    );
  } finally {
    await handle?.close();
  }
}

function invalid(message: string): never {
  throw new ClaudeNativeCatalogError("cache-invalid", message);
}
function unsupported(message: string): never {
  throw new ClaudeNativeCatalogError("unsupported-configuration", message);
}
function validateRowFields(value: JsonObject): void {
  for (const key of ["name", "description", "section", "min_claude_code_version"]) {
    if (value[key] !== undefined && typeof value[key] !== "string")
      invalid(`Invalid native model ${key}.`);
  }
  for (const key of ["disabled", "confidential"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      invalid(`Invalid native model ${key}.`);
  }
  for (const key of ["thinking", "runtime", "fast_mode"]) {
    if (value[key] !== undefined && !object(value[key])) invalid(`Invalid native model ${key}.`);
  }
}

function validateStringList(value: unknown, message: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) invalid(message);
}

function validateNativeOptions(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) invalid("Invalid native model options.");
  for (const entry of value) {
    if (!object(entry) || !text(entry.id) || !text(entry.name))
      invalid("Invalid native model options.");
  }
}

function parseRow(value: unknown): ClaudeNativeModelRow {
  if (!object(value) || !text(value.id)) return invalid("A native catalog model has no valid ID.");
  validateRowFields(value);
  if (value.offered_on !== null)
    validateStringList(value.offered_on, "Invalid native provider availability.");
  const row = value as unknown as ClaudeNativeModelRow;
  validateStringList(row.runtime?.effort_levels, "Invalid native runtime capabilities.");
  validateStringList(row.runtime?.capabilities, "Invalid native runtime capabilities.");
  validateNativeOptions(row.thinking?.effort_options);
  validateNativeOptions(row.thinking?.mode_options);
  validateNativeOptions(row.fast_mode?.options);
  return row;
}
function olderThan(version: string, minimum: string): boolean {
  const parse = (value: string) =>
    /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)?.slice(1).map(Number);
  const a = parse(version),
    b = parse(minimum);
  if (!a || !b) return unsupported("The native model minimum version cannot be compared.");
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}
function savedThinking(row: ClaudeNativeModelRow, state: JsonObject): JsonObject | undefined {
  if (Array.isArray(state.thinking_by_model)) {
    const perModel = state.thinking_by_model.find((entry) => object(entry) && entry.id === row.id);
    if (object(perModel) && object(perModel.thinking)) return perModel.thinking;
  }
  if (state.model === row.id && object(state.thinking)) return state.thinking;
  return undefined;
}

function thinkingOptions(
  row: ClaudeNativeModelRow,
  state: JsonObject,
): { thinkingOptions?: AgentSelectOption[]; defaultThinkingOptionId?: string } {
  const thinking = row.thinking;
  if (!thinking || thinking.type === "none") return {};
  if (thinking.type !== "effort" || thinking.mode_options?.length)
    return unsupported(
      "The native catalog advertises a thinking mode control that cannot be represented by effort selection.",
    );
  const entries = thinking.effort_options;
  if (!entries?.length)
    return unsupported("The native catalog does not describe its thinking choices.");
  const saved = savedThinking(row, state);
  const defaultId = text(saved?.effort) ?? text(saved?.mode) ?? text(row.runtime?.default_effort);
  const options: AgentSelectOption[] = [];
  for (const entry of entries) {
    const option: AgentSelectOption = {
      id: entry.id!,
      label: entry.name!,
      metadata: { source: "claude-code-disk-cache", ...entry },
    };
    if (entry.description) option.description = entry.description;
    if (entry.id === defaultId) option.isDefault = true;
    options.push(option);
  }
  if (defaultId && !options.some((option) => option.id === defaultId))
    return invalid("The native thinking default is not an advertised option.");
  return { thinkingOptions: options, defaultThinkingOptionId: defaultId };
}

interface NativeCatalogIdentity {
  configDir: string;
  filename: string;
  surface: ClaudeNativeCatalog["surface"];
  metadata: JsonObject;
}

async function readCatalogIdentity(
  options: ReadClaudeNativeCatalogOptions,
  env: NodeJS.ProcessEnv,
): Promise<NativeCatalogIdentity> {
  const home = os.homedir();
  const configDir = (
    options.configDir ??
    env.CLAUDE_CONFIG_DIR ??
    path.join(home, ".claude")
  ).normalize("NFC");
  const customDir =
    env.CLAUDE_CONFIG_DIR !== undefined || path.resolve(configDir) !== path.join(home, ".claude");
  const metadataPath = customDir
    ? path.join(configDir, ".claude.json")
    : path.join(home, ".claude.json");
  const metadata = await readJson(metadataPath, MAX_METADATA_BYTES, options.signal, true);
  if (!object(metadata) || !object(metadata.oauthAccount))
    throw new ClaudeNativeCatalogError(
      "identity-unavailable",
      "Claude Code account metadata is unavailable; no account cache was guessed.",
    );
  const account = metadata.oauthAccount;
  const accountId = text(env.CLAUDE_CODE_ACCOUNT_UUID) ?? text(account.accountUuid);
  const orgId = text(env.CLAUDE_CODE_ORGANIZATION_UUID) ?? text(account.organizationUuid);
  if (!accountId || !orgId || !UUID.test(accountId) || !UUID.test(orgId))
    throw new ClaudeNativeCatalogError(
      "identity-unavailable",
      "Claude Code account metadata does not identify a catalog cache.",
    );
  let surface: ClaudeNativeCatalog["surface"] = "cc";
  if (flag(env.CLAUDE_CODE_REMOTE)) surface = "ccr";
  else if (env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop") surface = "ccd";
  const filename = `${orgId.toLowerCase()}-${hash(accountId.toLowerCase()).slice(0, 12)}-${surface}.json`;
  return { configDir, filename, surface, metadata };
}

function validateCredentialScope(env: JsonObject): void {
  if (
    env.CLAUDE_CODE_OAUTH_TOKEN ||
    env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR ||
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_API_KEY
  )
    unsupported("Credential overrides do not identify the local signed-in account catalog safely.");
}

function parseCatalogCache(value: unknown, surface: ClaudeNativeCatalog["surface"]) {
  if (
    !object(value) ||
    value.version !== 2 ||
    typeof value.fetchedAt !== "number" ||
    !Number.isFinite(value.fetchedAt) ||
    typeof value.staleAt !== "number" ||
    !Number.isFinite(value.staleAt)
  )
    return invalid("Unsupported or malformed native catalog cache envelope.");
  if (value.catalog === null)
    throw new ClaudeNativeCatalogError(
      "surface-not-served",
      "Claude Code cached no models for this surface.",
    );
  if (
    !object(value.catalog) ||
    value.catalog.surface !== surface ||
    !object(value.catalog.config) ||
    value.catalog.config.id !== surface ||
    !Array.isArray(value.catalog.config.models)
  )
    return invalid("The native catalog has an invalid model list or surface.");
  return {
    raw: value,
    config: value.catalog.config,
    state: object(value.catalog.state) ? value.catalog.state : {},
    fetchedAt: value.fetchedAt,
    staleAt: value.staleAt,
  };
}

function validateProviderEnvironment(env: JsonObject): void {
  validateCredentialScope(env);
  if (
    flag(env.CLAUDE_CODE_USE_BEDROCK) ||
    flag(env.CLAUDE_CODE_USE_VERTEX) ||
    flag(env.CLAUDE_CODE_USE_FOUNDRY) ||
    text(env.ANTHROPIC_BASE_URL) ||
    text(env.ANTHROPIC_UNIX_SOCKET)
  )
    unsupported(
      "This served catalog applies to native first-party Claude Code, not an overridden provider.",
    );
  if (env.CLAUDE_CODE_MODEL_CATALOG === "0" || env.CLAUDE_CODE_MODEL_CATALOG === "false")
    unsupported("Claude Code model catalogs are disabled by configuration.");
  if (
    Object.keys(env).some(
      (key) =>
        /^ANTHROPIC_(DEFAULT_.*_MODEL(?:_NAME|_DESCRIPTION)?|CUSTOM_MODEL_OPTION.*)$/.test(key) &&
        text(env[key]),
    )
  )
    unsupported(
      "Custom model aliases and picker options need capabilities not resolved by this account cache.",
    );
}

function validateModelSettings(settings: JsonObject, env: JsonObject): void {
  if (
    settings.availableModels !== undefined ||
    settings.deniedModels !== undefined ||
    settings.modelPicker !== undefined
  )
    unsupported(
      "Local model allowlists, denylists or custom pickers require native policy resolution not present in the account cache.",
    );
  if (
    settings.effortLevel !== undefined ||
    settings.alwaysThinkingEnabled !== undefined ||
    env.CLAUDE_CODE_EFFORT_LEVEL !== undefined ||
    env.MAX_THINKING_TOKENS !== undefined
  )
    unsupported(
      "Explicit thinking overrides require native settings resolution beyond this cached catalog.",
    );
}

function readCatalogFeatures(metadata: JsonObject): JsonObject {
  const features = object(metadata.cachedGrowthBookFeatures)
    ? metadata.cachedGrowthBookFeatures
    : {};
  const experiment = features.tengu_delegated_quail;
  if (object(experiment) && (experiment.served ?? experiment.mode) !== "primary")
    unsupported("Claude Code is not configured to use its served catalog as the model picker.");
  const errorOverrides = features["tengu-model-error-overrides"];
  if (object(errorOverrides) && Object.keys(errorOverrides).length)
    unsupported("Native model error overrides cannot be resolved from this catalog alone.");
  return features;
}

function orderedCatalogRows(config: JsonObject): Map<string, ClaudeNativeModelRow> {
  const parsed = (config.models as unknown[]).map(parseRow);
  const rows = new Map<string, ClaudeNativeModelRow>();
  for (const row of [
    ...parsed.filter((entry) => entry.section !== "overflow"),
    ...parsed.filter((entry) => entry.section === "overflow"),
  ]) {
    const key = normalize(row.id);
    if (!rows.has(key)) rows.set(key, row);
  }
  return rows;
}

function catalogAliases(
  config: JsonObject,
  rows: ReadonlyMap<string, ClaudeNativeModelRow>,
): Record<string, string> {
  const aliases: Record<string, string> = Object.create(null);
  const targets = config.provider_alias_targets;
  if (targets == null) return aliases;
  if (!object(targets)) return invalid("Invalid native model aliases.");
  for (const [alias, target] of Object.entries(targets)) {
    if (target == null) continue;
    if (!object(target)) return invalid("Invalid native model alias target.");
    const id = text(target.default);
    if (!id) continue;
    const row = rows.get(normalize(id));
    if (row) aliases[normalize(alias)] = row.id;
  }
  return aliases;
}

async function readInstallationVersion(
  options: ReadClaudeNativeCatalogOptions,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  if (options.claudeCodeVersion) return options.claudeCodeVersion;
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = options.claudeExecutablePath
    ? [options.claudeExecutablePath]
    : (env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, executable));
  for (const candidate of candidates) {
    options.signal?.throwIfAborted();
    let installedPath: string;
    try {
      installedPath = await fs.realpath(candidate);
    } catch (error) {
      if (object(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) continue;
      return unsupported(
        "The native Claude installation version cannot be read without execution.",
      );
    }
    // Homebrew Cask and Claude's native installer encode the version in their target path.
    const match = /(?:^|[/\\])(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)(?:[/\\]|$)/.exec(installedPath);
    if (match) return match[1]!;
    break;
  }
  return unsupported(
    "Native model minimum versions require an installation path containing Claude Code's version; Claude was not executed.",
  );
}

function isOfferedRow(row: ClaudeNativeModelRow, features: JsonObject, version?: string): boolean {
  if (row.section === "deprecated" || (row.offered_on && !row.offered_on.includes("first_party")))
    return false;
  if (row.confidential)
    return unsupported(
      "Confidential native models require visibility state not present in the disk catalog.",
    );
  if (version && row.min_claude_code_version && olderThan(version, row.min_claude_code_version))
    return false;
  const fableGate = features["tengu-fable-off-switch"];
  if (object(fableGate) && fableGate.activated === true && row.runtime?.family === "fable")
    return unsupported(
      "Native Fable availability requires entitlement state not present in the disk catalog.",
    );
  return true;
}

function mapCatalogModel(
  row: ClaudeNativeModelRow,
  state: JsonObject,
  aliases: Record<string, string>,
  surface: ClaudeNativeCatalog["surface"],
  defaultId?: string,
): AgentModelDefinition {
  const input = row.runtime?.max_input_tokens ?? row.context_window;
  if (
    input !== undefined &&
    (typeof input !== "number" || !Number.isInteger(input) || input < 100000 || input > 10000000)
  )
    return invalid("Invalid native model context limit.");
  let description = text(row.description);
  if (row.disabled) {
    let notice: JsonObject | undefined;
    if (object(row.selection_notice)) notice = row.selection_notice;
    else if (object(row.notice)) notice = row.notice;
    description = text(notice?.text);
  }
  const model: AgentModelDefinition = {
    provider: "claude",
    id: row.id,
    label: text(row.name) ?? row.id,
    aliases: Object.keys(aliases).filter((alias) => aliases[alias] === row.id),
    metadata: { nativeCatalog: { ...row, surface, source: "claude-code-disk-cache" } },
    ...thinkingOptions(row, state),
  };
  if (row.disabled) model.isSelectable = false;
  if (row.id === defaultId) model.isDefault = true;
  if (description) model.description = description;
  if (typeof input === "number") model.contextWindowMaxTokens = input;
  return model;
}

function catalogCacheKey(
  raw: JsonObject,
  identity: NativeCatalogIdentity,
  settings: JsonObject,
  env: JsonObject,
  features: JsonObject,
  version?: string,
): string {
  const modelEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      /^(ANTHROPIC_(MODEL|DEFAULT_.*_MODEL|CUSTOM_MODEL_OPTION.*)|CLAUDE_CODE_(MODEL_CATALOG|REMOTE|ENTRYPOINT))$/.test(
        key,
      ),
    ),
  );
  return hash(
    JSON.stringify({
      cache: raw,
      claudeCodeVersion: version,
      account: identity.filename,
      settings: { model: settings.model },
      env: modelEnv,
      features: {
        experiment: features.tengu_delegated_quail,
        errorOverrides: features["tengu-model-error-overrides"],
        fable: features["tengu-fable-off-switch"],
      },
    }),
  );
}

async function readModelSettings(configDir: string, signal?: AbortSignal): Promise<JsonObject> {
  const value = await readJson(
    path.join(configDir, "settings.json"),
    MAX_METADATA_BYTES,
    signal,
    true,
  );
  if (value === undefined) return {};
  if (!object(value)) return invalid("Claude Code model settings are malformed.");
  return value;
}

async function catalogInstallationVersion(
  rows: ReadonlyMap<string, ClaudeNativeModelRow>,
  options: ReadClaudeNativeCatalogOptions,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (options.claudeCodeVersion) return options.claudeCodeVersion;
  for (const row of rows.values()) {
    if (row.min_claude_code_version) return readInstallationVersion(options, env);
  }
  return undefined;
}

/** Reads only local account metadata, settings and the exact native account cache. Never starts Claude. */
export async function readClaudeNativeCatalog(
  options: ReadClaudeNativeCatalogOptions = {},
): Promise<ClaudeNativeCatalog> {
  const env = options.env ?? process.env;
  validateCredentialScope(env);
  const identity = await readCatalogIdentity(options, env);
  const raw = await readJson(
    path.join(identity.configDir, "cache", "model-catalog", identity.filename),
    MAX_CACHE_BYTES,
    options.signal,
  );
  const cache = parseCatalogCache(raw, identity.surface);
  const settings = await readModelSettings(identity.configDir, options.signal);
  const settingsEnv = object(settings.env) ? settings.env : {};
  const modelEnv = { ...settingsEnv, ...env };
  validateProviderEnvironment(modelEnv);
  validateModelSettings(settings, modelEnv);
  const features = readCatalogFeatures(identity.metadata);
  const rows = orderedCatalogRows(cache.config);
  const aliases = catalogAliases(cache.config, rows);
  const resolveId = (id: string | undefined) =>
    id ? (aliases[normalize(id)] ?? rows.get(normalize(id))?.id) : undefined;
  const defaultModelId = resolveId(
    text(cache.state.org_enforced_default_model) ?? text(cache.state.model),
  );
  const selected = text(modelEnv.ANTHROPIC_MODEL) ?? text(settings.model);
  if (selected && !resolveId(selected))
    return unsupported(
      "The configured custom model has no capabilities in the native account catalog.",
    );
  const version = await catalogInstallationVersion(rows, options, env);
  const models: AgentModelDefinition[] = [];
  for (const row of rows.values()) {
    if (isOfferedRow(row, features, version))
      models.push(mapCatalogModel(row, cache.state, aliases, identity.surface, defaultModelId));
  }
  if (models.length === 0) return invalid("The native catalog contains no offered models.");
  const now = options.now ?? Date.now();
  return {
    models,
    cacheKey: catalogCacheKey(cache.raw, identity, settings, modelEnv, features, version),
    defaultModelId,
    selectedModelId: resolveId(selected),
    surface: identity.surface,
    fetchedAt: cache.fetchedAt,
    staleAt: cache.staleAt,
    stale:
      now < cache.fetchedAt || now >= cache.staleAt || cache.staleAt > cache.fetchedAt + 3960000,
    state: cache.state,
    providerAliasTargets: object(cache.config.provider_alias_targets)
      ? cache.config.provider_alias_targets
      : {},
    settingsVocabulary: object(cache.config.settings_vocabulary)
      ? cache.config.settings_vocabulary
      : {},
    aliases,
    rows,
  };
}
export function resolveClaudeNativeModelId(
  catalog: ClaudeNativeCatalog,
  id: string | null | undefined,
): string | undefined {
  if (id == null || normalize(id) === "default") return catalog.defaultModelId;
  const key = normalize(id);
  return catalog.aliases[key] ?? catalog.rows.get(key)?.id;
}
export function findClaudeNativeModel(
  catalog: ClaudeNativeCatalog,
  id: string | null | undefined,
): AgentModelDefinition | undefined {
  const resolved = resolveClaudeNativeModelId(catalog, id);
  return catalog.models.find((model) => model.id === resolved);
}

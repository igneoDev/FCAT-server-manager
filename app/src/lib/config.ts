import fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {ImportModsError, type ImportModsDiagnostics, type PresetFile, type ServerConfig, type ServerMod} from "../types.js";
import {getAppRoot} from "./paths.js";

const appRoot = getAppRoot();
const baseConfigPath = path.resolve(appRoot, "data", "base.json");

const modSchema = z.object({
  modId: z.string(),
  name: z.string(),
  version: z.string()
});

const serverConfigSchema: z.ZodType<ServerConfig> = z.object({
  game: z.object({
    mods: z.array(modSchema)
  }).passthrough()
}).passthrough();

function isPresetFileName(fileName: string): boolean {
  if (!fileName.endsWith(".json")) {
    return false;
  }

  return !["package.json", "package-lock.json", "server.json"].includes(fileName);
}

export async function loadBaseConfig(): Promise<ServerConfig> {
  const raw = await fs.readFile(baseConfigPath, "utf8");
  return serverConfigSchema.parse(JSON.parse(raw));
}

export async function listPresets(serverRoot: string): Promise<PresetFile[]> {
  const entries = await fs.readdir(serverRoot, {withFileTypes: true});
  const presets = entries
    .filter((entry) => entry.isFile() && isPresetFileName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const loaded = await Promise.all(
    presets.map(async (fileName) => {
      const presetPath = path.resolve(serverRoot, fileName);
      const raw = await fs.readFile(presetPath, "utf8");
      return {
        name: path.basename(fileName, ".json"),
        path: presetPath,
        config: serverConfigSchema.parse(JSON.parse(raw))
      };
    })
  );

  return loaded;
}

export async function savePreset(serverRoot: string, fileName: string, config: ServerConfig): Promise<string> {
  const outputPath = path.resolve(serverRoot, `${fileName}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return outputPath;
}

export async function writeRuntimeConfig(serverRoot: string, config: ServerConfig): Promise<string> {
  const outputPath = path.resolve(serverRoot, "server.json");
  await fs.writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return outputPath;
}

export function buildConfig(baseConfig: ServerConfig, overrideConfig: ServerConfig): ServerConfig {
  return deepMerge(baseConfig, overrideConfig);
}

export function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createPresetFromBase(baseConfig: ServerConfig, name: string): ServerConfig {
  const config = cloneConfig(baseConfig);
  config.game ??= {mods: []};
  config.game.name = name;
  return config;
}

export function parseImportedMods(rawInput: string): ServerMod[] {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return [];
  }

  const normalized = normalizeImportedModsInput(trimmed);
  const baseDiagnostics = createBaseDiagnostics(trimmed, normalized);

  let directSchemaError: ImportModsError | undefined;
  const direct = tryParse(normalized);
  if (direct.ok) {
    try {
      return validateImportedMods(direct.value, baseDiagnostics);
    } catch (error) {
      if (error instanceof ImportModsError) {
        directSchemaError = error;
      } else {
        throw error;
      }
    }
  }

  let wrappedSchemaError: ImportModsError | undefined;
  const wrapped = tryParse(`[${normalized}]`);
  if (wrapped.ok) {
    try {
      return validateImportedMods(wrapped.value, baseDiagnostics);
    } catch (error) {
      if (error instanceof ImportModsError) {
        wrappedSchemaError = error;
      } else {
        throw error;
      }
    }
  }

  if (wrappedSchemaError) {
    throw wrappedSchemaError;
  }

  if (directSchemaError) {
    throw directSchemaError;
  }

  throw new ImportModsError({
    ...baseDiagnostics,
    stage: "wrapped-parse",
    userMessage: "Nao foi possivel interpretar a lista de mods colada.",
    technicalMessage: (!wrapped.ok ? wrapped.errorMessage : undefined) ?? (!direct.ok ? direct.errorMessage : undefined) ?? "Falha desconhecida ao ler JSON.",
    directParseError: !direct.ok ? direct.errorMessage : undefined,
    wrappedParseError: !wrapped.ok ? wrapped.errorMessage : undefined
  });
}

function validateImportedMods(input: unknown, diagnostics: Omit<ImportModsDiagnostics, "stage" | "userMessage" | "technicalMessage">): ServerMod[] {
  try {
    const mods = z.array(modSchema).parse(input);
    return sortMods(mods);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ImportModsError({
        ...diagnostics,
        stage: "schema-validate",
        userMessage: "A lista foi lida como JSON, mas a estrutura dos mods esta invalida.",
        technicalMessage: error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; "),
        schemaIssues: error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      });
    }

    throw error;
  }
}

function sortMods(mods: ServerMod[]): ServerMod[] {
  return [...mods].sort((left, right) => {
    const priorityDifference = getPriority(left.name) - getPriority(right.name);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return left.name.localeCompare(right.name, undefined, {sensitivity: "base"});
  });
}

function getPriority(name: string): number {
  const rules: Array<[RegExp, number]> = [
    [/ACE /i, 0],
    [/RHS/i, 1],
    [/GRS/i, 4],
    [/Tactical[\s_]?Flava/i, 5],
    [/FCAT/i, 6]
  ];

  for (const [pattern, priority] of rules) {
    if (pattern.test(name)) {
      return priority;
    }
  }

  return 3;
}

function tryParse(value: string): {ok: true; value: unknown} | {ok: false; errorMessage: string} {
  try {
    return {ok: true, value: JSON.parse(value)};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {ok: false, errorMessage: message};
  }
}

function normalizeImportedModsInput(value: string): string {
  return value.replace(/,\s*$/, "").replace(/^\uFEFF/, "");
}

function createBaseDiagnostics(rawInput: string, normalizedInput: string): Omit<ImportModsDiagnostics, "stage" | "userMessage" | "technicalMessage"> {
  return {
    timestamp: new Date().toISOString(),
    rawLength: rawInput.length,
    normalizedLength: normalizedInput.length,
    lineCount: normalizedInput.split(/\r?\n/).length,
    sample: createSample(rawInput),
    normalizedSample: createSample(normalizedInput),
    suspiciousInputSignals: collectSuspiciousInputSignals(rawInput, normalizedInput)
  };
}

function createSample(value: string): string {
  const sanitized = value.replace(/\r/g, "\\r").replace(/\n/g, "\\n\n").replace(/\t/g, "\\t");

  if (sanitized.length <= 600) {
    return sanitized;
  }

  const head = sanitized.slice(0, 300);
  const tail = sanitized.slice(-300);
  return `${head}\n...\n${tail}`;
}

function collectSuspiciousInputSignals(rawInput: string, normalizedInput: string): string[] {
  const signals: string[] = [];

  if (rawInput !== normalizedInput) {
    signals.push("Input foi normalizado antes do parse.");
  }

  if (/\uFEFF/.test(rawInput)) {
    signals.push("Input contem BOM Unicode no inicio.");
  }

  if (/\u0000/.test(rawInput)) {
    signals.push("Input contem byte nulo.");
  }

  if (!normalizedInput.includes("\"modId\"")) {
    signals.push("Input nao contem a chave modId.");
  }

  if (!normalizedInput.includes("{") || !normalizedInput.includes("}")) {
    signals.push("Input nao parece conter objetos JSON completos.");
  }

  if (normalizedInput.length < 40) {
    signals.push("Input muito curto; possivel colagem truncada.");
  }

  return signals;
}

function deepMerge<T>(baseValue: T, overrideValue: T): T {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return cloneConfig(overrideValue);
  }

  if (!isObject(baseValue) || !isObject(overrideValue)) {
    return cloneConfig(overrideValue);
  }

  const result: Record<string, unknown> = {...baseValue};

  for (const [key, value] of Object.entries(overrideValue)) {
    const baseEntry = result[key];

    if (isObject(baseEntry) && isObject(value)) {
      result[key] = deepMerge(baseEntry, value);
      continue;
    }

    result[key] = cloneConfig(value);
  }

  return result as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

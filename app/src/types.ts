export interface ServerMod {
  modId: string;
  name: string;
  version: string;
}

export interface ServerConfig {
  bindAddress?: string;
  bindPort?: number;
  publicAddress?: string;
  publicPort?: number;
  a2s?: {
    address?: string;
    port?: number;
  };
  rcon?: {
    address?: string;
    port?: number;
    password?: string;
    permission?: string;
    blacklist?: string[];
    whitelist?: string[];
    maxClients?: number;
  };
  game: {
    name?: string;
    password?: string;
    passwordAdmin?: string;
    admins?: string[];
    scenarioId?: string;
    maxPlayers?: number;
    visible?: boolean;
    crossPlatform?: boolean;
    supportedPlatforms?: string[];
    gameProperties?: Record<string, unknown>;
    mods: ServerMod[];
    modsRequiredByDefault?: boolean;
  };
  [key: string]: unknown;
}

export interface PresetFile {
  name: string;
  path: string;
  config: ServerConfig;
}

export interface UpdateResult {
  modId: string;
  name: string;
  currentVersion: string;
  remoteVersion?: string;
  changed: boolean;
  source: "workshop" | "imported" | "unavailable";
  note?: string;
}

export type ImportModsErrorStage = "direct-parse" | "wrapped-parse" | "schema-validate";

export interface ImportModsDiagnostics {
  timestamp: string;
  stage: ImportModsErrorStage;
  userMessage: string;
  technicalMessage: string;
  rawLength: number;
  normalizedLength: number;
  lineCount: number;
  sample: string;
  normalizedSample: string;
  directParseError?: string;
  wrappedParseError?: string;
  schemaIssues?: string[];
  suspiciousInputSignals: string[];
  logPath?: string;
}

export class ImportModsError extends Error {
  readonly stage: ImportModsErrorStage;
  readonly userMessage: string;
  readonly technicalMessage: string;
  readonly sample: string;
  readonly diagnostics: ImportModsDiagnostics;
  logPath?: string;

  constructor(diagnostics: ImportModsDiagnostics) {
    super(diagnostics.technicalMessage);
    this.name = "ImportModsError";
    this.stage = diagnostics.stage;
    this.userMessage = diagnostics.userMessage;
    this.technicalMessage = diagnostics.technicalMessage;
    this.sample = diagnostics.sample;
    this.diagnostics = diagnostics;
  }
}

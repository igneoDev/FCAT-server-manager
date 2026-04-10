import path from "node:path";
import {fileURLToPath} from "node:url";
import fs from "node:fs/promises";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const SERVER_EXE_NAME = "ArmaReforgerServer.exe";

export function getAppRoot(): string {
  if (isPackagedExecutable()) {
    return path.dirname(process.execPath);
  }

  return path.resolve(currentDir, "..", "..");
}

export async function resolveServerRoot(preferredRoot?: string): Promise<string> {
  const candidates = [
    preferredRoot,
    path.resolve(getAppRoot(), ".."),
    getAppRoot(),
    path.resolve(getAppRoot(), "..", "..")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of dedupe(candidates)) {
    if (await hasServerExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error("ArmaReforgerServer.exe nao encontrado automaticamente. Configure manualmente a pasta do servidor.");
}

function isPackagedExecutable(): boolean {
  const executableName = path.basename(process.execPath).toLowerCase();
  return executableName !== "node.exe" && executableName !== "node";
}

async function hasServerExecutable(root: string): Promise<boolean> {
  try {
    await fs.access(path.resolve(root, SERVER_EXE_NAME));
    return true;
  } catch {
    return false;
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

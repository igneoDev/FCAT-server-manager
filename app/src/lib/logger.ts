import fs from "node:fs/promises";
import path from "node:path";
import {getAppRoot} from "./paths.js";

const appRoot = getAppRoot();
const logsDir = path.resolve(appRoot, "logs");
const appLogPath = path.resolve(logsDir, "import-errors.log");

export async function appendImportLog(payload: unknown): Promise<string> {
  await fs.mkdir(logsDir, {recursive: true});
  const serialized = JSON.stringify(payload, null, 2);
  await fs.appendFile(appLogPath, `${serialized}\n\n`, "utf8");
  return appLogPath;
}

export function getImportLogPath(): string {
  return appLogPath;
}

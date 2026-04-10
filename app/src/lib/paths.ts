import path from "node:path";
import {fileURLToPath} from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function getAppRoot(): string {
  if (isPackagedExecutable()) {
    return path.dirname(process.execPath);
  }

  return path.resolve(currentDir, "..", "..");
}

export function getServerRoot(): string {
  return path.resolve(getAppRoot(), "..");
}

function isPackagedExecutable(): boolean {
  const executableName = path.basename(process.execPath).toLowerCase();
  return executableName !== "node.exe" && executableName !== "node";
}

import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {serverRoot} from "./config.js";

export async function launchServer(configPath: string): Promise<void> {
  const executablePath = path.resolve(serverRoot, "ArmaReforgerServer.exe");
  await fs.access(executablePath);

  const windowsTerminal = await resolveWindowsTerminal();

  const child = windowsTerminal
    ? spawn(windowsTerminal, [
        "-w",
        "0",
        "new-tab",
        "--title",
        "Arma Reforger Server",
        "-d",
        serverRoot,
        "powershell.exe",
        "-NoExit",
        "-Command",
        `& '${escapeForPowershell(executablePath)}' -config '${escapeForPowershell(configPath)}' -loadSessionSave`
      ], {
        cwd: serverRoot,
        detached: true,
        stdio: "ignore"
      })
    : spawn("powershell.exe", [
        "-NoExit",
        "-Command",
        `Set-Location '${escapeForPowershell(serverRoot)}'; & '${escapeForPowershell(executablePath)}' -config '${escapeForPowershell(configPath)}' -loadSessionSave`
      ], {
        cwd: serverRoot,
        detached: true,
        stdio: "ignore"
      });

  child.unref();
}

async function resolveWindowsTerminal(): Promise<string | null> {
  const localAppData = process.env.LOCALAPPDATA;

  if (localAppData) {
    const candidate = path.resolve(localAppData, "Microsoft", "WindowsApps", "wt.exe");

    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  return null;
}

function escapeForPowershell(value: string): string {
  return value.replace(/'/g, "''");
}

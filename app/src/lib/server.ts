import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";

export async function launchServer(serverRoot: string, configPath: string): Promise<void> {
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
    : await launchWithCmdWindow(serverRoot, executablePath, configPath);

  child.unref();
}

async function launchWithCmdWindow(serverRoot: string, executablePath: string, configPath: string) {
  const launcherPath = path.resolve(serverRoot, "start-managed-server.cmd");
  const launcherScript = [
    "@echo off",
    `cd /d "${serverRoot}"`,
    `"${executablePath}" -config "${configPath}" -loadSessionSave`,
    "echo.",
    "echo O servidor foi encerrado. Pressione uma tecla para fechar esta janela.",
    "pause >nul"
  ].join("\r\n");

  await fs.writeFile(launcherPath, `${launcherScript}\r\n`, "utf8");

  return spawn("cmd.exe", [
    "/d",
    "/s",
    "/c",
    `start "Arma Reforger Server" /d "${serverRoot}" cmd.exe /k "${launcherPath}"`
  ], {
        cwd: serverRoot,
        detached: true,
        stdio: "ignore"
      });
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

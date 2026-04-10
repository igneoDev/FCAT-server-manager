import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";

export async function launchServer(serverRoot: string, configPath: string): Promise<void> {
  const executablePath = path.resolve(serverRoot, "ArmaReforgerServer.exe");
  await fs.access(executablePath);
  const child = await launchWithCmdWindow(serverRoot, executablePath, configPath);

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
    "/c",
    "start",
    "",
    "/d",
    serverRoot,
    "cmd.exe",
    "/k",
    launcherPath
  ], {
    cwd: serverRoot,
    detached: true,
    stdio: "ignore"
  });
}

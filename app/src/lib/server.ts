import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRuntimeRoot } from "./paths.js";
import type { ServerProcessInfo } from "../types.js";

const PROCESS_FILE_NAME = "server-process.json";

export async function launchServer(
  serverRoot: string,
  configPath: string,
): Promise<ServerProcessInfo> {
  const executablePath = path.resolve(serverRoot, "ArmaReforgerServer.exe");
  await fs.access(executablePath);

  await fs.mkdir(getRuntimeRoot(), { recursive: true });

  const pid = await startServerWindow(
    serverRoot,
    path.basename(executablePath),
    configPath,
  );

  const processInfo: ServerProcessInfo = {
    pid,
    serverRoot,
    configPath,
    startedAt: new Date().toISOString(),
  };

  await saveProcessInfo(processInfo);

  return processInfo;
}

export async function stopServerProcess(): Promise<boolean> {
  const processInfo = await getServerProcessInfo();
  if (!processInfo) {
    return false;
  }

  const running = await isProcessRunning(processInfo.pid);
  if (!running) {
    await removeProcessInfo();
    return false;
  }

  await killProcessTree(processInfo.pid);
  await removeProcessInfo();
  return true;
}

export async function isTrackedServerRunning(): Promise<boolean> {
  const processInfo = await getServerProcessInfo();
  if (!processInfo) {
    return false;
  }

  const running = await isProcessRunning(processInfo.pid);
  if (!running) {
    await removeProcessInfo();
  }

  return running;
}

export async function getServerProcessInfo(): Promise<ServerProcessInfo | null> {
  try {
    const filePath = getProcessFilePath();
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<ServerProcessInfo>;

    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.serverRoot !== "string" ||
      typeof parsed.configPath !== "string" ||
      typeof parsed.startedAt !== "string"
    ) {
      return null;
    }

    return {
      pid: parsed.pid,
      serverRoot: parsed.serverRoot,
      configPath: parsed.configPath,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

async function startServerWindow(
  serverRoot: string,
  executableName: string,
  configPath: string,
): Promise<number> {
  const executablePath = path.resolve(serverRoot, executableName);
  const pid = await launchWithPowershell(
    serverRoot,
    executablePath,
    configPath,
  );

  if (!Number.isFinite(pid)) {
    throw new Error(
      `Falha ao iniciar o servidor. PID invalido retornado: ${String(pid)}`,
    );
  }

  return pid;
}

async function launchWithPowershell(
  serverRoot: string,
  executablePath: string,
  configPath: string,
): Promise<number> {
  const serverCommand = [
    `& '${escapeForPowershell(executablePath)}'`,
    `-config '${escapeForPowershell(configPath)}'`,
    "-loadSessionSave;",
    "Write-Host '';",
    'Write-Host "Server process finished. Press Enter to close...";',
    "Read-Host",
  ].join(" ");

  const stdout = await execFileCapture("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    [
      "$process = Start-Process",
      "-FilePath 'powershell.exe'",
      `-WorkingDirectory '${escapeForPowershell(serverRoot)}'`,
      `-ArgumentList @('-NoExit', '-Command', '${escapeForPowershell(serverCommand)}')`,
      "-PassThru;",
      "$process.Id",
    ].join(" "),
  ]);

  const pid = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(pid)) {
    throw new Error(`PowerShell nao retornou PID valido: ${stdout.trim()}`);
  }

  return pid;
}

function escapeForPowershell(value: string): string {
  return value.replace(/'/g, "''");
}

async function saveProcessInfo(processInfo: ServerProcessInfo): Promise<void> {
  const filePath = getProcessFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify(processInfo, null, 2)}\n`,
    "utf8",
  );
}

async function removeProcessInfo(): Promise<void> {
  try {
    await fs.unlink(getProcessFilePath());
  } catch {
    // Ignore missing runtime file.
  }
}

function getProcessFilePath(): string {
  return path.resolve(getRuntimeRoot(), PROCESS_FILE_NAME);
}

async function isProcessRunning(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("tasklist.exe", ["/FI", `PID eq ${pid}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    child.on("close", () => {
      resolve(output.includes(String(pid)));
    });

    child.on("error", () => {
      resolve(false);
    });
  });
}

async function killProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Falha ao encerrar o servidor. taskkill saiu com codigo ${code}.`,
        ),
      );
    });

    child.on("error", reject);
  });
}

async function execFileCapture(
  command: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            `Falha ao executar ${command}. Codigo de saida ${code}.`,
        ),
      );
    });

    child.on("error", reject);
  });
}

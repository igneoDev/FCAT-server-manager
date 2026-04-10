import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seaDir = path.resolve(appRoot, ".sea");
const outputExe = path.resolve(appRoot, "ReforgerServerManager-sea.exe");
const postjectCli = path.resolve(appRoot, "node_modules", "postject", "dist", "cli.js");

await run(process.execPath, ["--experimental-sea-config", "sea-config.json"], seaDir);
await fs.copyFile(process.execPath, outputExe);

await run(process.execPath, [
  postjectCli,
  outputExe,
  "NODE_SEA_BLOB",
  path.resolve(seaDir, "sea-prep.blob"),
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
], appRoot);

await fs.copyFile(path.resolve(seaDir, "app.mjs"), path.resolve(appRoot, "app.mjs"));
await fs.mkdir(path.resolve(appRoot, "data"), {recursive: true});
await fs.copyFile(path.resolve(seaDir, "data", "base.json"), path.resolve(appRoot, "data", "base.json"));

console.log(`SEA gerado em ${outputExe}`);

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} terminou com codigo ${code}`));
    });

    child.on("error", reject);
  });
}

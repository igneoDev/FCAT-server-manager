import {build} from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seaDir = path.resolve(appRoot, ".sea");

await fs.rm(seaDir, {recursive: true, force: true});
await fs.mkdir(seaDir, {recursive: true});

await build({
  entryPoints: [path.resolve(appRoot, "src", "index.tsx")],
  outfile: path.resolve(seaDir, "app.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  jsx: "automatic",
  sourcemap: false,
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module'; const require = __createRequire(import.meta.url);"
  }
});

await fs.mkdir(path.resolve(seaDir, "data"), {recursive: true});
await fs.copyFile(
  path.resolve(appRoot, "data", "base.json"),
  path.resolve(seaDir, "data", "base.json")
);

const bootstrap = `
const path = require('node:path');
const {pathToFileURL} = require('node:url');

(async () => {
  const entryPath = path.resolve(path.dirname(process.execPath), 'app.mjs');
  await import(pathToFileURL(entryPath).href);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`.trimStart();

await fs.writeFile(path.resolve(seaDir, "bootstrap.cjs"), bootstrap, "utf8");

const seaConfig = {
  main: "./bootstrap.cjs",
  output: "./sea-prep.blob",
  disableExperimentalSEAWarning: true
};

await fs.writeFile(path.resolve(seaDir, "sea-config.json"), `${JSON.stringify(seaConfig, null, 2)}\n`, "utf8");

console.log(`Bundle SEA gerado em ${seaDir}`);

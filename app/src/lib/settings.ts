import fs from "node:fs/promises";
import path from "node:path";
import type {AppSettings} from "../types.js";
import {getAppRoot} from "./paths.js";

const settingsPath = path.resolve(getAppRoot(), "settings.json");

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return JSON.parse(raw) as AppSettings;
  } catch {
    return {};
  }
}

export async function saveSettings(settings: AppSettings): Promise<string> {
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settingsPath;
}

export function getSettingsPath(): string {
  return settingsPath;
}

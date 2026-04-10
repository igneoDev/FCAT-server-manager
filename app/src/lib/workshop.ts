import type {ServerMod, UpdateResult} from "../types.js";

const WORKSHOP_BASE_URL = "https://reforger.armaplatform.com/workshop";
const MAX_CONCURRENT_REQUESTS = 6;

export async function checkModsAgainstWorkshop(mods: ServerMod[]): Promise<UpdateResult[]> {
  const results = await mapWithConcurrency(mods, MAX_CONCURRENT_REQUESTS, async (mod) => lookupModVersion(mod));
  return results.sort((left, right) => Number(right.changed) - Number(left.changed));
}

export function checkModsAgainstImportedList(currentMods: ServerMod[], importedMods: ServerMod[]): UpdateResult[] {
  const importedMap = new Map(importedMods.map((mod) => [mod.modId, mod]));

  return currentMods.map((mod) => {
    const imported = importedMap.get(mod.modId);

    if (!imported) {
      return {
        modId: mod.modId,
        name: mod.name,
        currentVersion: mod.version,
        changed: false,
        source: "imported",
        note: "Nao encontrado na lista importada."
      } satisfies UpdateResult;
    }

    return {
      modId: mod.modId,
      name: mod.name,
      currentVersion: mod.version,
      remoteVersion: imported.version,
      changed: mod.version !== imported.version,
      source: "imported"
    } satisfies UpdateResult;
  });
}

async function lookupModVersion(mod: ServerMod): Promise<UpdateResult> {
  const url = `${WORKSHOP_BASE_URL}/${mod.modId}`;

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "reforger-server-tui/1.0"
      }
    });

    if (!response.ok) {
      return unavailable(mod, `HTTP ${response.status}`);
    }

    const html = await response.text();
    const facts = extractWorkshopFacts(html);
    const remoteVersion = facts.get("Version");

    if (!remoteVersion) {
      return unavailable(mod, "Campo Version nao encontrado no workshop.");
    }

    const lastModified = facts.get("Last Modified");

    return {
      modId: mod.modId,
      name: mod.name,
      currentVersion: mod.version,
      remoteVersion,
      changed: remoteVersion !== mod.version,
      source: "workshop",
      note: lastModified ? `Last Modified: ${lastModified}` : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return unavailable(mod, message);
  }
}

function extractWorkshopFacts(html: string): Map<string, string> {
  const facts = new Map<string, string>();
  const dlMatch = html.match(/<dl>([\s\S]*?)<\/dl>/i);

  if (!dlMatch?.[1]) {
    return facts;
  }

  const pairPattern = /<div[^>]*>\s*<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>\s*<\/div>/gi;

  for (const match of dlMatch[1].matchAll(pairPattern)) {
    const key = normalizeText(match[1]);
    const value = normalizeText(match[2]);

    if (key && value) {
      facts.set(key, value);
    }
  }

  return facts;
}

function normalizeText(value: string): string {
  return decodeHtml(stripTags(value))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function unavailable(mod: ServerMod, note: string): UpdateResult {
  return {
    modId: mod.modId,
    name: mod.name,
    currentVersion: mod.version,
    changed: false,
    source: "unavailable",
    note
  };
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({length: workerCount}, () => worker()));
  return results;
}

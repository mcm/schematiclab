// Block ids, property domains and defaults for one Minecraft version, fetched
// on demand from jsDelivr and cached in memory (per server instance, best
// effort). 1.14 and later read misode/mcmeta's `<version>-summary` tag; 1.13.x
// and 1.12.2 read minecraft-data's 1.13.2 blocks at a pinned commit. 1.12.2
// blocks are flattened ids, translated on export by the flatten table.
//
// Imports carry their `.ts` extension so `scripts/check-block-data.mts` can
// load this file with `node --experimental-strip-types`.

import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/known-versions.ts";

export interface BlockInfo {
  /** Property name → every value it takes, in the game's order. */
  properties: Record<string, string[]>;
  /** Property name → the default state's value. */
  defaults: Record<string, string>;
}

export interface BlockData {
  /** The version whose data was loaded (`1.13.2` for 1.12.2 and 1.13.x). */
  sourceVersion: string;
  /** True when blocks are flattened ids the exporter must translate (1.12.2). */
  translateOnExport: boolean;
  /** `minecraft:`-prefixed block id → its states. */
  blocks: Map<string, BlockInfo>;
}

export interface BlockDataDeps {
  fetch: typeof fetch;
}

export const BLOCK_DATA_TIMEOUT_MS = 10_000;
export const MAX_BLOCK_DATA_BYTES = 5 * 1024 * 1024;

// minecraft-data commit pinned for data/pc/1.13.2/blocks.json.
export const MINECRAFT_DATA_COMMIT = "095709f3ad62b043069141dc127fc80ef6cd10fa";

type SourceFormat = "mcmeta" | "minecraft-data";

interface BlockDataSource {
  format: SourceFormat;
  url: string;
  /** mcmeta's registries, for summaries that leave out property-less blocks. */
  registriesUrl?: string;
  sourceVersion: string;
  translateOnExport: boolean;
}

// Every KNOWN_VERSIONS key is digits and dots; checked again before it goes
// into a URL.
const VERSION_PATTERN = /^\d+(?:\.\d+){1,2}$/;

export function blockDataSource(versionId: string): BlockDataSource {
  if (
    !Object.prototype.hasOwnProperty.call(KNOWN_VERSIONS, versionId) ||
    !VERSION_PATTERN.test(versionId)
  ) {
    throw new Error(`Unknown Minecraft version "${versionId}".`);
  }
  const [major, minor] = KNOWN_VERSIONS[versionId].versionNumber;
  if (major > 1 || minor >= 14) {
    const base = `https://cdn.jsdelivr.net/gh/misode/mcmeta@${versionId}-summary`;
    return {
      format: "mcmeta",
      url: `${base}/blocks/data.min.json`,
      registriesUrl: `${base}/registries/data.min.json`,
      sourceVersion: versionId,
      translateOnExport: false,
    };
  }
  if (minor === 12 || minor === 13) {
    return {
      format: "minecraft-data",
      url: `https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-data@${MINECRAFT_DATA_COMMIT}/data/pc/1.13.2/blocks.json`,
      sourceVersion: "1.13.2",
      translateOnExport: minor === 12,
    };
  }
  throw new Error(`No block data for Minecraft ${versionId}.`);
}

// Parsed blocks per source URL; 1.12.2 and 1.13.x share one entry. Failed
// loads are dropped so the next call retries.
const cache = new Map<string, Promise<Map<string, BlockInfo>>>();

export function clearBlockDataCache(): void {
  cache.clear();
}

export async function loadBlockData(
  versionId: string,
  deps: BlockDataDeps,
): Promise<BlockData> {
  const source = blockDataSource(versionId);
  let blocks = cache.get(source.url);
  if (!blocks) {
    blocks = fetchBlocks(source, deps);
    cache.set(source.url, blocks);
    blocks.catch(() => {
      if (cache.get(source.url) === blocks) cache.delete(source.url);
    });
  }
  return {
    sourceVersion: source.sourceVersion,
    translateOnExport: source.translateOnExport,
    blocks: await blocks,
  };
}

async function fetchBlocks(
  source: BlockDataSource,
  deps: BlockDataDeps,
): Promise<Map<string, BlockInfo>> {
  const json = await fetchJson(source.url, deps);
  if (source.format === "minecraft-data") return parseMinecraftDataBlocks(json);
  const blocks = parseMcmetaBlocks(json);
  // Summaries before 1.20.5 only list blocks that have properties; the block
  // registry has the rest.
  if (!blocks.has("minecraft:air") && source.registriesUrl) {
    for (const id of parseMcmetaBlockRegistry(
      await fetchJson(source.registriesUrl, deps),
    )) {
      if (!blocks.has(id)) blocks.set(id, { properties: {}, defaults: {} });
    }
  }
  return blocks;
}

async function fetchJson(url: string, deps: BlockDataDeps): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLOCK_DATA_TIMEOUT_MS);
  try {
    const response = await deps.fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Block data request failed (HTTP ${response.status}).`);
    }
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_BLOCK_DATA_BYTES) throw tooLarge();
    const text = await readText(response, controller.signal);
    return JSON.parse(text);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `Block data request timed out after ${BLOCK_DATA_TIMEOUT_MS / 1000} s.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function tooLarge(): Error {
  return new Error(
    `Block data response is over ${MAX_BLOCK_DATA_BYTES / (1024 * 1024)} MB.`,
  );
}

// Reads the body while counting bytes, so an oversized response without a
// content-length is cut off instead of buffered whole.
async function readText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  aborted.catch(() => {});
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BLOCK_DATA_BYTES) throw tooLarge();
      chunks.push(value);
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function malformed(detail: string): Error {
  return new Error(`Malformed block data: ${detail}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blockId(name: string): string {
  return name.includes(":") ? name : `minecraft:${name}`;
}

// mcmeta summary: `{ id: [{ property: values[] }, { property: default }] }`.
export function parseMcmetaBlocks(json: unknown): Map<string, BlockInfo> {
  if (!isRecord(json)) throw malformed("expected an object of blocks");
  const blocks = new Map<string, BlockInfo>();
  for (const [name, entry] of Object.entries(json)) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw malformed(`block ${name} is not [properties, defaults]`);
    }
    const [domains, defaults] = entry;
    if (!isRecord(domains) || !isRecord(defaults)) {
      throw malformed(`block ${name} is not [properties, defaults]`);
    }
    const info: BlockInfo = { properties: {}, defaults: {} };
    for (const [prop, values] of Object.entries(domains)) {
      if (
        !Array.isArray(values) ||
        values.length === 0 ||
        !values.every((v) => typeof v === "string")
      ) {
        throw malformed(`block ${name} property ${prop} has no values`);
      }
      const value = defaults[prop];
      if (typeof value !== "string" || !values.includes(value)) {
        throw malformed(`block ${name} property ${prop} has no valid default`);
      }
      info.properties[prop] = values;
      info.defaults[prop] = value;
    }
    blocks.set(blockId(name), info);
  }
  return blocks;
}

// mcmeta registries summary: `{ registry: ids[] }`; returns the block ids.
export function parseMcmetaBlockRegistry(json: unknown): string[] {
  if (
    !isRecord(json) ||
    !Array.isArray(json.block) ||
    !json.block.every((id) => typeof id === "string")
  ) {
    throw malformed("the registries have no block list");
  }
  return json.block.map(blockId);
}

interface MinecraftDataState {
  name: string;
  num_values: number;
  values: string[];
}

function stateValues(block: string, state: unknown): MinecraftDataState {
  if (
    !isRecord(state) ||
    typeof state.name !== "string" ||
    typeof state.num_values !== "number" ||
    !Number.isInteger(state.num_values) ||
    state.num_values < 1
  ) {
    throw malformed(`block ${block} has an invalid state`);
  }
  const { name, type, num_values } = state;
  let values: string[];
  if (Array.isArray(state.values)) {
    if (!state.values.every((v) => typeof v === "string")) {
      throw malformed(`block ${block} property ${name} has invalid values`);
    }
    values = state.values;
  } else if (type === "bool") {
    // Mojang orders boolean properties true, false (state ids follow it).
    values = ["true", "false"];
  } else if (type === "int") {
    // Every value-less int property in 1.13.2 starts at 0.
    values = Array.from({ length: num_values }, (_, i) => String(i));
  } else {
    throw malformed(`block ${block} property ${name} has no values`);
  }
  if (values.length !== num_values) {
    throw malformed(
      `block ${block} property ${name} has the wrong value count`,
    );
  }
  return { name, num_values, values };
}

// minecraft-data `blocks.json`: an array of blocks with `states` and state ids.
// State ids count through the properties with the last one varying fastest,
// so the default's values come from `defaultState - minStateId`.
export function parseMinecraftDataBlocks(
  json: unknown,
): Map<string, BlockInfo> {
  if (!Array.isArray(json)) throw malformed("expected an array of blocks");
  const blocks = new Map<string, BlockInfo>();
  for (const block of json) {
    if (!isRecord(block) || typeof block.name !== "string") {
      throw malformed("a block has no name");
    }
    const name = block.name;
    const states = (Array.isArray(block.states) ? block.states : []).map(
      (state) => stateValues(name, state),
    );
    const { minStateId, maxStateId, defaultState } = block;
    if (
      typeof minStateId !== "number" ||
      typeof maxStateId !== "number" ||
      typeof defaultState !== "number"
    ) {
      throw malformed(`block ${name} has no state ids`);
    }
    const count = states.reduce((n, s) => n * s.num_values, 1);
    let index = defaultState - minStateId;
    if (maxStateId - minStateId + 1 !== count || index < 0 || index >= count) {
      throw malformed(`block ${name} has inconsistent state ids`);
    }
    const info: BlockInfo = { properties: {}, defaults: {} };
    const picked: string[] = [];
    for (let i = states.length - 1; i >= 0; i--) {
      const state = states[i];
      picked[i] = state.values[index % state.num_values];
      index = Math.floor(index / state.num_values);
    }
    states.forEach((state, i) => {
      info.properties[state.name] = state.values;
      info.defaults[state.name] = picked[i];
    });
    blocks.set(blockId(name), info);
  }
  return blocks;
}

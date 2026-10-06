// The CurseForge pack source of the upload CLI
// (`pnpm modpack:upload --curseforge <slug|id> [--file <id>]`): resolves the
// pack project (class 4471), picks its latest file (or `--file`), downloads
// the pack zip, reads its `manifest.json` and downloads every mod file into a
// temp directory created for the run, which is removed when `run` returns.
// Jars stay in that directory; only `extractModpack`'s derived data leaves.
//
// Downloads go only to the CurseForge CDN hosts the download route allows
// (`curseforge/constants.ts`), every redirect hop re-checked, with bounded
// concurrency and retries of transient failures. A file without a
// `downloadUrl` (its author disallows distribution) is
// `skipped-undistributable`, one over the jar size cap `skipped-too-large`,
// unless `localModsDir` (`--mods-dir`, e.g. a server install's `mods/`)
// holds a jar of the same file name and size, which is read instead.
//
// Node only (`node:fs`). Imports carry their `.ts` extension so node's
// strip-types can load it.

import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, type UnzipFileInfo } from "fflate";

import {
  CURSEFORGE_API_BASE,
  MAX_CDN_REDIRECTS,
  MINECRAFT_GAME_ID,
  MODPACKS_CLASS_ID,
  MODS_CLASS_ID,
  isAllowedCdnUrl,
} from "../curseforge/constants.ts";
import { forEachLimit } from "../mods/for-each-limit.ts";
import type { ModpackModSource, ModpackSource } from "./extract.ts";
import { EXPORT_MANIFEST_NAME, parsePackManifest } from "./pack-manifest.ts";
import { MODPACK_SLUG_PATTERN } from "./schema.ts";

/** Pack zips bigger than this aren't downloaded. */
export const MAX_PACK_ZIP_BYTES = 512 * 1024 * 1024;
/** Mod files downloaded at once. */
export const DEFAULT_DOWNLOAD_CONCURRENCY = 6;
/** Tries per request, including the first. */
const MAX_ATTEMPTS = 4;
const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 30_000;
/** Ids per batch request (`POST /v1/mods`, `POST /v1/mods/files`). */
const BATCH_SIZE = 100;
const FILES_PAGE_SIZE = 50;
/** CurseForge's files listing refuses `index + pageSize` above this. */
const MAX_FILES_LISTED = 10_000;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

/** Told to the operator when mods couldn't be downloaded from CurseForge. */
export const UNDISTRIBUTABLE_HINT =
  "Some mods' authors disallow third-party downloads. Re-run with --mods-dir <an installed copy's mods folder> to include them.";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface CurseForgePackOptions {
  apiKey: string;
  /** Project slug or numeric project id. */
  project: string;
  /** Pack file id; default the project's latest file. */
  fileId?: number;
  /** Mod jars over this many bytes are `skipped-too-large`. */
  maxJarBytes: number;
  /**
   * A folder of jars (an installed copy's `mods/`) read for files that
   * can't be downloaded: undistributable or over `maxJarBytes`.
   */
  localModsDir?: string;
  concurrency?: number;
  /** Where the run's temp directory is created (default the OS's). */
  tempRoot?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Progress output. */
  log?: (line: string) => void;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A failure worth retrying (network error, timeout, 408, 429, 5xx). */
class TransientError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** A download over the size cap. */
class TooLargeError extends Error {}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (value.trim() !== "" && Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The CurseForge pack's project, as resolved. */
export interface CurseForgePackProject {
  id: number;
  name: string;
  slug: string;
}

/** A CurseForge file's metadata, as far as the upload needs it. */
interface CurseForgeFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  fileLength: number;
  fileDate: string;
  downloadUrl: string | null;
  isServerPack: boolean;
}

function toFile(raw: unknown): CurseForgeFile | null {
  const f = asObject(raw);
  const id = positiveInt(f.id);
  const modId = positiveInt(f.modId);
  if (id === null || modId === null) return null;
  return {
    id,
    modId,
    displayName: str(f.displayName) ?? str(f.fileName) ?? String(id),
    fileName: str(f.fileName) ?? `${id}.jar`,
    fileLength:
      typeof f.fileLength === "number" && Number.isFinite(f.fileLength)
        ? f.fileLength
        : 0,
    fileDate: str(f.fileDate) ?? "",
    downloadUrl: str(f.downloadUrl),
    isServerPack: f.isServerPack === true,
  };
}

/** Talks to the CurseForge API and CDN with retries. */
class CurseForgeClient {
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly apiKey: string;

  constructor(options: CurseForgePackOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.apiKey = options.apiKey;
  }

  /** Runs `attempt` until it doesn't throw a `TransientError`. */
  async retrying<T>(attempt: () => Promise<T>): Promise<T> {
    for (let tries = 1; ; tries++) {
      try {
        return await attempt();
      } catch (err) {
        if (!(err instanceof TransientError) || tries >= MAX_ATTEMPTS) {
          throw err;
        }
        const wait = Math.min(
          err.retryAfterMs ?? 1000 * 2 ** (tries - 1),
          MAX_RETRY_DELAY_MS,
        );
        await this.sleep(wait);
      }
    }
  }

  /** A CurseForge API call; returns the parsed JSON body. */
  api(
    apiPath: string,
    params?: Record<string, string | number>,
    body?: unknown,
  ): Promise<unknown> {
    const query =
      params === undefined
        ? ""
        : `?${new URLSearchParams(
            Object.entries(params).map(([k, v]) => [k, String(v)]),
          ).toString()}`;
    const url = `${CURSEFORGE_API_BASE}${apiPath}${query}`;
    return this.retrying(async () => {
      let res: Response;
      try {
        res = await this.fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "x-api-key": this.apiKey,
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
          redirect: "error",
        });
      } catch (err) {
        throw new TransientError(
          `CurseForge request failed: ${errorMessage(err)}`,
        );
      }
      if (!res.ok) {
        await res.body?.cancel();
        const message = `CurseForge returned HTTP ${res.status} for ${apiPath}.`;
        if (isTransientStatus(res.status)) {
          throw new TransientError(
            message,
            retryAfterMs(res.headers.get("Retry-After")),
          );
        }
        throw new Error(
          res.status === 403 ? `${message} Check CURSEFORGE_API_KEY.` : message,
        );
      }
      try {
        return (await res.json()) as unknown;
      } catch {
        throw new TransientError(
          `CurseForge returned an invalid response for ${apiPath}.`,
        );
      }
    });
  }

  /**
   * Downloads `start` (a CurseForge CDN URL) to `file`, following redirects
   * by hand so each hop is checked against the allowlist. Throws
   * `TooLargeError` past `limit` bytes.
   */
  download(start: string, file: string, limit: number): Promise<void> {
    return this.retrying(async () => {
      const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
      let url: URL;
      try {
        url = new URL(start);
      } catch {
        throw new Error(`Invalid download URL ${start}.`);
      }
      let res: Response | null = null;
      for (let hop = 0; hop <= MAX_CDN_REDIRECTS; hop++) {
        if (!isAllowedCdnUrl(url)) {
          throw new Error(
            `Download host ${url.host} isn't a CurseForge CDN host.`,
          );
        }
        let hopRes: Response;
        try {
          hopRes = await this.fetch(url.toString(), {
            signal,
            redirect: "manual",
          });
        } catch (err) {
          throw new TransientError(`CDN request failed: ${errorMessage(err)}`);
        }
        if (hopRes.status < 300 || hopRes.status >= 400) {
          res = hopRes;
          break;
        }
        await hopRes.body?.cancel();
        const location = hopRes.headers.get("Location");
        if (!location) throw new Error("CDN redirect without a location.");
        try {
          url = new URL(location, url);
        } catch {
          throw new Error(`Invalid CDN redirect to ${location}.`);
        }
      }
      if (res === null) throw new Error("Too many redirects from the CDN.");
      if (!res.ok || res.body === null) {
        await res.body?.cancel();
        const message = `CDN returned HTTP ${res.status}.`;
        if (isTransientStatus(res.status)) {
          throw new TransientError(
            message,
            retryAfterMs(res.headers.get("Retry-After")),
          );
        }
        throw new Error(message);
      }
      // fetch decodes a compressed body, but Content-Length stays the
      // encoded size: only trust it for identity responses.
      const encoding = res.headers.get("Content-Encoding");
      const identity =
        !encoding || encoding.trim().toLowerCase() === "identity";
      const length = Number(res.headers.get("Content-Length") ?? "");
      if (identity && Number.isFinite(length) && length > limit) {
        await res.body.cancel().catch(() => {});
        throw new TooLargeError(`The file is ${length} bytes.`);
      }

      const handle = await open(file, "w");
      let seen = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (err) {
            throw new TransientError(
              `CDN download failed: ${errorMessage(err)}`,
            );
          }
          if (chunk.done) break;
          seen += chunk.value.byteLength;
          if (seen > limit) {
            await reader.cancel().catch(() => {});
            throw new TooLargeError(`The file is over ${limit} bytes.`);
          }
          await handle.write(chunk.value);
        }
      } catch (err) {
        await handle.close();
        await rm(file, { force: true });
        throw err;
      }
      await handle.close();
    });
  }
}

async function resolveProject(
  client: CurseForgeClient,
  project: string,
): Promise<CurseForgePackProject> {
  let raw: Json;
  if (/^[1-9]\d*$/.test(project)) {
    raw = asObject(asObject(await client.api(`/v1/mods/${project}`)).data);
  } else {
    const found = asObject(
      await client.api("/v1/mods/search", {
        gameId: MINECRAFT_GAME_ID,
        classId: MODPACKS_CLASS_ID,
        slug: project,
      }),
    ).data;
    const match = (Array.isArray(found) ? found : [])
      .map(asObject)
      .find((m) => m.slug === project);
    if (match === undefined) {
      throw new Error(`CurseForge has no modpack with the slug "${project}".`);
    }
    raw = match;
  }
  const id = positiveInt(raw.id);
  if (id === null) {
    throw new Error(`CurseForge returned no project for "${project}".`);
  }
  if (raw.gameId !== MINECRAFT_GAME_ID || raw.classId !== MODPACKS_CLASS_ID) {
    throw new Error(
      `CurseForge project ${id} (${str(raw.name) ?? "unnamed"}) isn't a Minecraft modpack.`,
    );
  }
  return {
    id,
    name: str(raw.name) ?? `CurseForge project ${id}`,
    slug: str(raw.slug) ?? String(id),
  };
}

async function resolvePackFile(
  client: CurseForgeClient,
  project: CurseForgePackProject,
  fileId: number | undefined,
): Promise<CurseForgeFile> {
  if (fileId !== undefined) {
    const file = toFile(
      asObject(await client.api(`/v1/mods/${project.id}/files/${fileId}`)).data,
    );
    if (file === null || file.modId !== project.id) {
      throw new Error(`File ${fileId} isn't a file of ${project.name}.`);
    }
    if (file.isServerPack) {
      throw new Error(
        `File ${fileId} is a server pack; pass the client pack's file id.`,
      );
    }
    return file;
  }
  let latest: CurseForgeFile | null = null;
  for (let index = 0; index < MAX_FILES_LISTED; index += FILES_PAGE_SIZE) {
    const page = asObject(
      await client.api(`/v1/mods/${project.id}/files`, {
        index,
        pageSize: FILES_PAGE_SIZE,
      }),
    );
    const files = Array.isArray(page.data) ? page.data : [];
    for (const raw of files) {
      const file = toFile(raw);
      if (file === null || file.isServerPack) continue;
      if (latest === null || file.fileDate > latest.fileDate) latest = file;
    }
    const total = positiveInt(asObject(page.pagination).totalCount) ?? 0;
    if (files.length < FILES_PAGE_SIZE || index + files.length >= total) {
      break;
    }
  }
  if (latest === null) throw new Error(`${project.name} has no files.`);
  return latest;
}

/** `POST /v1/<what>` with `{ <key>: ids }` in batches; returns every `data`. */
async function batch(
  client: CurseForgeClient,
  apiPath: string,
  key: string,
  ids: readonly number[],
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const body = { [key]: ids.slice(i, i + BATCH_SIZE) };
    const data = asObject(await client.api(apiPath, undefined, body)).data;
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

/** A path-safe file name for a jar in the temp directory. */
function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

function jarFromDisk(
  base: Omit<ModpackModSource, "read" | "size">,
  file: string,
  size: number,
): ModpackModSource {
  return {
    ...base,
    size,
    read: async () => new Uint8Array(await readFile(file)),
  };
}

/**
 * `fileName` in `dir` when it's there with the size CurseForge lists, else
 * null. File names with a path in them are never looked up.
 */
async function localJar(
  dir: string | undefined,
  fileName: string,
  fileLength: number,
): Promise<string | null> {
  if (dir === undefined || fileName !== path.basename(fileName)) return null;
  const file = path.join(dir, fileName);
  try {
    const info = await stat(file);
    return info.isFile() && info.size === fileLength ? file : null;
  } catch {
    return null;
  }
}

/**
 * Resolves and downloads the pack, calls `run` with it as a `ModpackSource`
 * whose mods read their jars from the run's temp directory, and removes that
 * directory afterwards (also when `run` throws).
 */
export async function withCurseForgePack<T>(
  options: CurseForgePackOptions,
  run: (source: ModpackSource, project: CurseForgePackProject) => Promise<T>,
): Promise<T> {
  const client = new CurseForgeClient(options);
  const log = options.log ?? (() => {});

  const project = await resolveProject(client, options.project);
  const packFile = await resolvePackFile(client, project, options.fileId);
  log(
    `${project.name}: file ${packFile.id} (${packFile.displayName}) from CurseForge`,
  );
  if (packFile.downloadUrl === null) {
    throw new Error(
      `${project.name} file ${packFile.id} has no download URL. Install the pack and use --instance.`,
    );
  }
  if (packFile.fileLength > MAX_PACK_ZIP_BYTES) {
    throw new Error(
      `${project.name} file ${packFile.id} is over ${MAX_PACK_ZIP_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const tempDir = await mkdtemp(
    path.join(options.tempRoot ?? tmpdir(), "schematiclab-modpack-"),
  );
  try {
    const zipFile = path.join(tempDir, "pack.zip");
    try {
      await client.download(packFile.downloadUrl, zipFile, MAX_PACK_ZIP_BYTES);
    } catch (err) {
      throw new Error(
        `Couldn't download ${project.name} file ${packFile.id}: ${errorMessage(err)}`,
      );
    }
    const source = await readPackZip(
      client,
      project,
      packFile,
      new Uint8Array(await readFile(zipFile)),
      tempDir,
      options,
      log,
    );
    await rm(zipFile, { force: true });
    return await run(source, project);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readPackZip(
  client: CurseForgeClient,
  project: CurseForgePackProject,
  packFile: CurseForgeFile,
  zip: Uint8Array,
  tempDir: string,
  options: CurseForgePackOptions,
  log: (line: string) => void,
): Promise<ModpackSource> {
  const limit = options.maxJarBytes;
  let manifestBytes: Uint8Array | undefined;
  try {
    manifestBytes = unzipSync(zip, {
      filter: (f) =>
        f.name === EXPORT_MANIFEST_NAME && f.originalSize <= MAX_MANIFEST_BYTES,
    })[EXPORT_MANIFEST_NAME];
  } catch (err) {
    throw new Error(`The pack file isn't a zip: ${errorMessage(err)}`);
  }
  if (manifestBytes === undefined) {
    throw new Error(`The pack zip has no ${EXPORT_MANIFEST_NAME}.`);
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (err) {
    throw new Error(
      `The pack's ${EXPORT_MANIFEST_NAME} isn't JSON: ${errorMessage(err)}`,
    );
  }
  const manifest = parsePackManifest(
    rawManifest,
    `The pack's ${EXPORT_MANIFEST_NAME}`,
  );

  const mods: ModpackModSource[] = [];
  const warnings: string[] = [];

  // Jars shipped in the pack itself (overrides/mods), keyed by SHA-256.
  const modsPrefix = `${manifest.overrides}/mods/`;
  const kubejsPrefix = `${manifest.overrides}/kubejs/`;
  let hasKubeJs = false;
  const oversized: UnzipFileInfo[] = [];
  const overrideJars = unzipSync(zip, {
    filter: (f) => {
      if (f.name.startsWith(kubejsPrefix)) hasKubeJs = true;
      const isJar =
        f.name.startsWith(modsPrefix) &&
        !f.name.slice(modsPrefix.length).includes("/") &&
        f.name.toLowerCase().endsWith(".jar");
      if (isJar && f.originalSize > limit) oversized.push(f);
      return isJar && f.originalSize <= limit;
    },
  });
  for (const info of oversized) {
    const fileName = info.name.slice(modsPrefix.length);
    mods.push({
      name: fileName.replace(/\.jar$/i, ""),
      fileName,
      curseForgeProjectId: null,
      curseForgeFileId: null,
      size: null,
      read: null,
      missingStatus: "skipped-too-large",
      missingMessage: `The jar is ${info.originalSize} bytes, over the ${limit}-byte limit.`,
    });
  }
  for (const [index, [name, bytes]] of Object.entries(overrideJars).entries()) {
    const fileName = name.slice(modsPrefix.length);
    const file = path.join(tempDir, `override-${index}-${safeName(fileName)}`);
    await writeFile(file, bytes);
    mods.push(
      jarFromDisk(
        {
          name: fileName.replace(/\.jar$/i, ""),
          fileName,
          curseForgeProjectId: null,
          curseForgeFileId: null,
        },
        file,
        bytes.byteLength,
      ),
    );
  }

  // CurseForge files: metadata in batches, then the downloads.
  const seen = new Set<number>();
  const files = manifest.files.filter((f) => {
    if (seen.has(f.fileId)) return false;
    seen.add(f.fileId);
    return true;
  });
  const fileMeta = new Map<number, CurseForgeFile>();
  for (const raw of await batch(
    client,
    "/v1/mods/files",
    "fileIds",
    files.map((f) => f.fileId),
  )) {
    const file = toFile(raw);
    if (file !== null) fileMeta.set(file.id, file);
  }
  const projectMeta = new Map<number, Json>();
  for (const raw of await batch(client, "/v1/mods", "modIds", [
    ...new Set(files.map((f) => f.projectId)),
  ])) {
    const mod = asObject(raw);
    const id = positiveInt(mod.id);
    if (id !== null) projectMeta.set(id, mod);
  }

  const toDownload: {
    base: Omit<ModpackModSource, "read" | "size">;
    url: string;
  }[] = [];
  const notMods: string[] = [];
  for (const { projectId, fileId } of files) {
    const meta = projectMeta.get(projectId);
    const name = str(meta?.name) ?? `CurseForge project ${projectId}`;
    const classId = positiveInt(meta?.classId);
    if (classId !== null && classId !== MODS_CLASS_ID) {
      // Resource packs, shaders, worlds: not mods, no blocks.
      notMods.push(name);
      continue;
    }
    const file = fileMeta.get(fileId);
    const base = {
      name,
      fileName: file?.fileName ?? null,
      curseForgeProjectId: projectId,
      curseForgeFileId: fileId,
    };
    if (file === undefined || file.modId !== projectId) {
      mods.push({
        ...base,
        size: null,
        read: null,
        missingMessage: `CurseForge doesn't list file ${fileId} of project ${projectId}.`,
      });
    } else if (file.downloadUrl === null || file.fileLength > limit) {
      const local = await localJar(
        options.localModsDir,
        file.fileName,
        file.fileLength,
      );
      if (local !== null) {
        mods.push(jarFromDisk(base, local, file.fileLength));
      } else if (file.downloadUrl === null) {
        mods.push({
          ...base,
          size: null,
          read: null,
          missingStatus: "skipped-undistributable",
          missingMessage: `The author disallows third-party downloads; re-run with --mods-dir <folder with ${file.fileName}> to include it.`,
        });
      } else {
        mods.push({
          ...base,
          size: null,
          read: null,
          missingStatus: "skipped-too-large",
          missingMessage: `The jar is ${file.fileLength} bytes, over the ${limit}-byte limit (CURSEFORGE_MAX_JAR_BYTES); re-run with --mods-dir <folder with ${file.fileName}> to include it.`,
        });
      }
    } else {
      toDownload.push({ base, url: file.downloadUrl });
    }
  }
  if (notMods.length > 0) {
    warnings.push(
      `${notMods.length} pack files aren't mods (resource packs, shaders…) and were left out: ${notMods.join(", ")}.`,
    );
  }

  log(`Downloading ${toDownload.length} mod files…`);
  let done = 0;
  await forEachLimit(
    toDownload,
    options.concurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY,
    async ({ base, url }) => {
      const file = path.join(tempDir, `cf-${base.curseForgeFileId}.jar`);
      try {
        await client.download(url, file, limit);
        mods.push(jarFromDisk(base, file, (await stat(file)).size));
      } catch (err) {
        const tooLarge = err instanceof TooLargeError;
        mods.push({
          ...base,
          size: null,
          read: null,
          missingStatus: tooLarge ? "skipped-too-large" : "failed",
          missingMessage: tooLarge
            ? `${err.message} The limit is ${limit} bytes (CURSEFORGE_MAX_JAR_BYTES).`
            : `Download failed: ${errorMessage(err)}`,
        });
      }
      done++;
      if (done % 25 === 0 || done === toDownload.length) {
        log(`  downloaded ${done}/${toDownload.length}`);
      }
    },
  );
  mods.sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: project.name,
    ...(MODPACK_SLUG_PATTERN.test(project.slug) ? { slug: project.slug } : {}),
    displayVersion: manifest.version ?? packFile.displayName,
    minecraftVersion: manifest.minecraftVersion,
    loader: manifest.loader,
    curseForgeProjectId: project.id,
    packFileId: packFile.id,
    mods,
    hasKubeJs,
    warnings,
  };
}

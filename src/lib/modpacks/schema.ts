// Schemas for uploaded modpack data in the private Blob store: the index of
// every uploaded pack (`modpacks/index.json`) and one merged record per pack
// version (`pack.json.gz`). The upload CLI writes them and the MCP tools read
// them, so both go through these types. Worker-safe: no DOM, no Node APIs.
//
// Bump MODPACK_FORMAT_VERSION on any change an older reader or writer can't
// handle; the reader rejects other versions instead of guessing.

import { z } from "zod";
import type { BlockKind } from "../blockdata/registry.ts";

export const MODPACK_FORMAT_VERSION = 1;

/** Lower-case words joined by single hyphens, e.g. `all-the-mods-10`. */
export const MODPACK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A pack version key or a mod-file key, used as one Blob path segment:
 * `cf-<file id>` for CurseForge files, `sha256-<hex>` for instance jars
 * without CurseForge ids.
 */
export const BLOB_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const slug = z.string().regex(MODPACK_SLUG_PATTERN);
const blobKey = z.string().regex(BLOB_KEY_PATTERN);
const isoDate = z.iso.datetime({ offset: true });
const curseForgeId = z.number().int().positive();

export const MODPACK_LOADERS = [
  "forge",
  "neoforge",
  "fabric",
  "quilt",
  "vanilla",
  "unknown",
] as const;
export type ModpackLoader = (typeof MODPACK_LOADERS)[number];

// ---------------------------------------------------------------------------
// modpacks/index.json

export const modpackIndexVersionSchema = z.object({
  /** Path segment of this version's `pack.json.gz`. */
  key: blobKey,
  /** CurseForge file id of the pack file, null for instance-folder uploads. */
  packFileId: curseForgeId.nullable(),
  /** The pack's own version label, e.g. `4.12`. */
  displayVersion: z.string().min(1),
  minecraftVersion: z.string().min(1),
  loader: z.enum(MODPACK_LOADERS),
  modCount: z.number().int().nonnegative(),
  uploadedAt: isoDate,
});
export type ModpackIndexVersion = z.infer<typeof modpackIndexVersionSchema>;

export const modpackIndexEntrySchema = z.object({
  slug,
  name: z.string().min(1),
  curseForgeProjectId: curseForgeId.nullable(),
  versions: z.array(modpackIndexVersionSchema),
});
export type ModpackIndexEntry = z.infer<typeof modpackIndexEntrySchema>;

export const modpackIndexSchema = z.object({
  formatVersion: z.number().int(),
  packs: z.array(modpackIndexEntrySchema),
});
export type ModpackIndex = z.infer<typeof modpackIndexSchema>;

// ---------------------------------------------------------------------------
// modpacks/<slug>/<version key>/pack.json.gz

export const MOD_STATUSES = [
  "ok",
  "no-blocks",
  "skipped-undistributable",
  "skipped-too-large",
  "failed",
] as const;
export type ModStatus = (typeof MOD_STATUSES)[number];

export const modpackModSchema = z.object({
  /** Mod-file key: blocks name their mod by it, swatches live under it. */
  key: blobKey,
  name: z.string().min(1),
  curseForgeProjectId: curseForgeId.nullable(),
  curseForgeFileId: curseForgeId.nullable(),
  fileName: z.string().nullable(),
  /** Asset namespaces the jar ships, sorted. */
  namespaces: z.array(z.string()),
  status: z.enum(MOD_STATUSES),
  /** Why the mod was skipped or failed. */
  message: z.string().optional(),
  /** True when `mod-files/<key>/swatches.png` was uploaded. */
  hasSwatches: z.boolean(),
});
export type ModpackMod = z.infer<typeof modpackModSchema>;

/** The registry's shape kinds, plus `unknown` when the evidence is unclear. */
export const MOD_BLOCK_KINDS = [
  "air",
  "block",
  "stairs",
  "slab",
  "wall",
  "fence",
  "fence_gate",
  "door",
  "trapdoor",
  "pane",
  "log",
  "pillar",
  "button",
  "pressure_plate",
  "lever",
  "bed",
  "torch",
  "wall_torch",
  "lantern",
  "carpet",
  "chest",
  "sign",
  "banner",
  "pot",
  "leaves",
  "plant",
  "flat",
  "glass",
  "unknown",
] as const satisfies readonly (BlockKind | "unknown")[];
export type ModBlockKind = (typeof MOD_BLOCK_KINDS)[number];

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/);
const unit = z.number().min(0).max(1);

export const modBlockAppearanceSchema = z.object({
  /** Alpha-weighted average colour of the default state's faces. */
  hex: hexColor,
  /** OKLab `[L, a, b]` of the average. */
  oklab: z.tuple([z.number(), z.number(), z.number()]),
  /** Up to 3 main colours with their share of opaque texels, largest first. */
  dominant: z.array(z.object({ hex: hexColor, share: unit })).max(3),
  /** How much the texture varies around its average, 0 (flat) to 1. */
  variance: unit,
});
export type ModBlockAppearance = z.infer<typeof modBlockAppearanceSchema>;

/** Pixel rectangle `[x, y, width, height]` in a swatch sheet. */
const swatchRect = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().positive(),
  z.number().int().positive(),
]);

export const modBlockSwatchSchema = z.object({
  /** Mod-file key: the sheet is `mod-files/<file>/swatches.png`. */
  file: blobKey,
  /** Face (`top`, `side`, `bottom`) → its 16×16 rectangle in the sheet. */
  faces: z.record(z.string(), swatchRect),
});
export type ModBlockSwatch = z.infer<typeof modBlockSwatchSchema>;

export const modBlockCamoSchema = z.object({
  /** Camo slots the block saves (2 for FramedBlocks double blocks). */
  slots: z.number().int().min(1).max(2),
});

export const modpackBlockSchema = z.object({
  /** Namespaced block id, e.g. `create:brass_block`. */
  id: z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/),
  /** Key of the mod in `mods` that ships the block. */
  mod: blobKey,
  displayName: z.string(),
  /** Property name → every value it takes. */
  properties: z.record(z.string(), z.array(z.string())),
  /** Property name → the default state's value. */
  defaults: z.record(z.string(), z.string()),
  kind: z.enum(MOD_BLOCK_KINDS),
  fullCube: z.boolean(),
  /** Absent when the default state's textures couldn't be resolved. */
  appearance: modBlockAppearanceSchema.optional(),
  swatch: modBlockSwatchSchema.optional(),
  /** Present on camo-capable blocks (FramedBlocks, copycats). */
  camo: modBlockCamoSchema.optional(),
});
export type ModpackBlock = z.infer<typeof modpackBlockSchema>;

/** Blocks registered at runtime that the pack data can't contain. */
export const runtimeBlockSourceSchema = z.object({
  kind: z.enum(["kubejs", "generated-block-provider"]),
  /** `kubejs` or the provider mod's name. */
  name: z.string().min(1),
  message: z.string(),
});
export type RuntimeBlockSource = z.infer<typeof runtimeBlockSourceSchema>;

export const modpackDataSchema = z.object({
  formatVersion: z.number().int(),
  slug,
  name: z.string().min(1),
  curseForgeProjectId: curseForgeId.nullable(),
  version: modpackIndexVersionSchema,
  mods: z.array(modpackModSchema),
  /** Every mod block, sorted by id. */
  blocks: z.array(modpackBlockSchema),
  runtimeBlockSources: z.array(runtimeBlockSourceSchema),
});
export type ModpackData = z.infer<typeof modpackDataSchema>;

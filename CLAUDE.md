# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Schematiclab is a Next.js 16 / React 19 app (pnpm) that converts Minecraft schematics between formats and Minecraft versions, entirely client-side. It has two modes: Simple Mode (`src/app/page.tsx`: drop a file, pick an output format and version, download) and the Advanced Editor (`src/app/advanced/page.tsx`: 3D preview, material list, block swaps, version-mapping preview, and CurseForge mod loading so modded blocks render).

## Commands

```bash
pnpm dev                 # next dev
pnpm build               # production build (output: "standalone")
pnpm test                # vitest run (all tests)
pnpm exec vitest run src/lib/__tests__/convert.test.ts   # single file
pnpm exec vitest run -t "name of test"                   # by test name
pnpm lint                # eslint
pnpm typecheck           # tsc --noEmit
pnpm format              # prettier --write . (CI runs prettier --check)
```

CI (`.github/workflows/ci.yml`) requires lint, the prettier check, typecheck, `vitest run --coverage`, build, Semgrep (`--config auto` + `p/trailofbits`, errors fail the build) and TruffleHog. Run lint, format and typecheck before calling work done.

Tests run in the `node` environment (`vitest.config.ts`) and include only `src/**/*.test.ts`. IndexedDB code is tested with `fake-indexeddb`. Binary schematic fixtures live in `src/lib/__tests__/fixtures/`.

### Codegen (rarely needed)

These scripts use `node --experimental-strip-types` and expect sibling checkouts of external data repos (`~/projects/minecraft-data` / `../minecraft-data`, plus `misode/mcmeta`; you can point at other locations with `MINECRAFT_DATA_PATH` and `MCMETA_PATH`):

- `pnpm gen:translations` regenerates `src/lib/schemlib/data/block-translations.generated.ts` and `forge-1.12-flatten.generated.ts`. Don't hand-edit `*.generated.ts`. Change `manual-overrides.ts` or `forge-1.12-specs.ts` and regenerate.
- `pnpm gen:mc-assets` rebuilds the vanilla 3D-preview bundle in `public/minecraft-assets/` (texture atlas, UVs, blockstates, models, opaque-block list).
- `scripts/regenerate-known-versions.mts` regenerates `schematic-formats/known-versions.ts`.

### Environment

`CURSEFORGE_API_KEY` (server-only) enables the Mods tab. Without it, `/api/curseforge/*` returns 503. Escape `$` as `\$` in `.env.local`. See `.env.example`.

## Architecture

### schemlib (`src/lib/schemlib/`)

This is a TypeScript port of a Python library, and file headers name the Python original. Every format extends `AbstractSchematic`/`AbstractRegion` (`schematic-formats/abstract.ts`), which provide static `schematicLoad`, `fromSchematic(other, targetVersion)` and `getDefaultExtension`, plus instance `schematicDump`. Conversion always goes through `IntermediateSchematic` (`intermediate.ts`), so a new format only needs to convert to and from the intermediate form. `detect.ts` (`detectSchematicType`) sniffs bytes as JSON, then NBT, then SNBT. The ids it returns (`"Sponge[v2]"`, `"BuildingGadgets2[1.20+]"`, and so on) are stable identifiers used across the whole app. NBT and SNBT codecs are hand-written (`nbt.ts`, `snbt.ts`).

**`FORMATS.md` is the source of truth** for format ids, canonical extensions (one per format family) and output rules. The `JSON` intermediate format is dev-only and must never appear as an output choice in production UI.

Version translation lives in `schematic-formats/version-mapping.ts` and `data/translate.ts`. It walks a codegen'd chain of per-anchor-version block-state diffs (one anchor per major.minor), uses a flatten table for 1.12 ↔ 1.13, and chains Forge 1.12 `name[variant=...]` states through `id:meta`. Lossy translations report through `onWarning`. Doors get a cross-block fixup (`fixupDoors`) after per-block mapping.

### Worker boundary

`src/lib/convert.ts` is the only orchestration API the UI uses. It must stay worker-safe (no DOM). In production it runs inside `convert.worker.ts`, and the main thread calls it through `convert-client.ts` (`detectInWorker`, `convertInWorker`, `parseInWorker`, `cancel`). Schematic class instances can't be structured-cloned, so the worker returns a plain `ParsedSchematicProjection`: palette with counts, plus per-region placements that index into the palette, with air excluded. Editor edits such as block swaps (`swap-projection.ts`) operate on that projection, and export re-serializes it via `serializeSchematic`. Mod jars use the same pattern with `mods/mod-jar.worker.ts` and `mod-jar-client.ts`.

### Client state

State lives in module-level stores that components subscribe to with `useSyncExternalStore`, not in React context. `editor-state.ts` holds the staged file and parse status. It survives client-side navigation between `/` and `/advanced` but resets on reload. Heavy edit and undo operations live in `editor-state-edits.ts` (swap and translation snapshots are tracked separately) so they stay out of the `/` bundle. Keep bundle splits in mind: code imported by Simple Mode shouldn't pull in deepslate or the advanced editor. That's why `invisible-blocks.ts` is its own module.

### Mods and CurseForge

- Server routes (`src/app/api/curseforge/**`) proxy CurseForge. Shared validation, upstream fetch and payload trimming live in `lib/curseforge/server.ts`. The download route streams jars up to `CURSEFORGE_MAX_JAR_BYTES`. `lib/curseforge/client.ts` is the browser side and handles retries of transient failures, including `Retry-After`.
- `mods/load-mod.ts` runs the load pipeline: pick a file, download, parse in the worker, then register and persist. `parse-mod-jar.ts` only inflates `assets/*/{blockstates,models,textures,lang/en_us.json}` behind zip-bomb size limits. It never loads class files.
- `mods/registry.ts` is the reactive set of loaded mods. It hydrates from IndexedDB (`mods/store.ts`) and falls back to in-memory storage when IndexedDB is unavailable.

### 3D preview (`src/lib/render/`)

The preview uses deepslate. `minecraft-resources.ts` fetches the vanilla bundle from `public/minecraft-assets/` and rebuilds a combined texture atlas and model set whenever the mod registry snapshot changes. Layout (`atlas-layout.ts`, capped at a power-of-two size, downscales textures when they don't fit) and resource assembly (`block-resources.ts`) are pure and unit-tested. Only pixel drawing touches the DOM. Modded blocks that can't be rendered fall back to a magenta/black "missing" cube instead of disappearing.

### Other

- `/api/import-url` fetches pastebin.com or gist.github.com URLs server-side, using a hostname-equality allowlist.
- UI components come from the private `@iamthemcmaster/ui` package (installing it needs `NPM_TOKEN`), and icons come from `@tabler/icons-react`.
- The `@/*` import alias maps to `src/*`.
- Unused variables must be prefixed with `_` to satisfy lint.

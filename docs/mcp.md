# Schematiclab MCP server

Schematiclab runs a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents can write schematic files, check block ids and see what they built. It reuses the app's own converter, Shape Generator and Static Renders.

## Endpoint

```text
https://<deploy>/api/mcp
```

`<deploy>` is the Schematiclab deploy's host (production or a Vercel preview).

- Transport: streamable HTTP, stateless. Each request is answered on its own; there are no sessions (no `mcp-session-id`), no subscriptions and no server-sent notifications.
- Authentication: none. The endpoint is public and anonymous, and is rate limited per IP (see [Rate limit](#rate-limit)).
- Code: tool logic is in `src/lib/mcp/`, and `src/app/api/mcp/[transport]/route.ts` is the Next route (`/api/mcp` is rewritten to `/api/mcp/mcp`).

## Connecting

### Claude Code

```bash
claude mcp add --transport http schematiclab https://<deploy>/api/mcp
```

Run `/mcp` in Claude Code to check that it is connected and to list its tools.

### Claude Desktop

Open **Settings → Connectors → Add custom connector**, enter a name (for example "Schematiclab") and the URL `https://<deploy>/api/mcp`, and leave the OAuth fields empty.

Claude Desktop versions without custom connectors can reach the server through the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "schematiclab": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<deploy>/api/mcp"]
    }
  }
}
```

### Other clients

Any MCP client with streamable HTTP support works. Send JSON-RPC as `POST /api/mcp` with `content-type: application/json` and `accept: application/json, text/event-stream`.

## Tools

Every tool that takes a Minecraft version accepts the ids `list_versions` returns (for example `1.12.2`, `1.20.1`, `1.21.4`), and every tool that writes a file accepts the format ids it returns. Errors (an unknown version, a block missing from a version, a file over a limit…) are returned as tool errors (`isError: true`) with a message saying what to change.

Tools that return data return it twice: as `structuredContent` (matching the tool's output schema) and as JSON in a text content block, for clients that only read text. `render_schematic` is the exception: it returns only a PNG image and a plain-text summary. `compile_build` and `check_build` return their report as markdown text and a summary as `structuredContent`.

### Modpacks

Every block-aware tool (`search_blocks`, `suggest_palette`, `show_blocks`, `inspect_schematic`, `convert_schematic`, `render_schematic`, `generate_shape`, `compile_build`, `check_build`) takes an optional `modpack`: a modpack the operator uploaded with [`pnpm modpack:upload`](#uploading-modpacks), named by a ref.

| Ref                       | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `all-the-mods-10`         | The pack's latest upload.                                                 |
| `all-the-mods-10@5678901` | A specific upload, by its CurseForge pack file id.                        |
| `all-the-mods-10@1.2.3`   | A specific upload, by its display version (used when no file id matches). |

`list_modpacks` lists the packs and their refs. With a `modpack`, a tool accepts exactly the pack's blocks: the vanilla blocks of the pack's Minecraft version plus its mods' blocks. Anything else is rejected (`generate_shape`, `show_blocks`, `suggest_palette`'s `reference_block`), reported at its program path (`compile_build`, `check_build`) or flagged (`inspect_schematic`, `convert_schematic`, `render_schematic`). `version` may be left out where it is optional: it is the pack's Minecraft version. A `version` that differs from the pack's is a tool error. Mods the upload skipped or failed, and blocks registered at runtime (KubeJS scripts, Every Compat, Unlimited Chisel Works), aren't in the pack; `list_modpacks` reports both.

The tool descriptions tell agents to call `list_modpacks` when a user names a pack, to pass `modpack` to every block tool, and to check how blocks look with `show_blocks` rather than trusting their names. The `design_build` prompt adds the same instructions when given a `modpack`.

The pack data (`modpacks/<slug>/<version key>/pack.json.gz`, see [Uploading modpacks](#uploading-modpacks)) is read once per server instance and cached; the read times out after 10 seconds. Without a Blob store, a `modpack` is a tool error.

### Schematic inputs

`inspect_schematic`, `convert_schematic` and `render_schematic` read a schematic given as exactly one of:

| Field                | Meaning                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                | A `https://pastebin.com/…` or `https://gist.github.com/…` URL, or a file URL returned by another Schematiclab tool (read back from its Blob store). Other URLs are refused. |
| `base64`, `filename` | The file's bytes in base64 (a `data:` prefix and URL-safe base64 are accepted) and its file name. The format is detected from the bytes; the name is used to name outputs.  |

The file can be at most 5 MB once decoded.

### Output files

Tools that write a file upload it to a private Vercel Blob store and return a signed download URL:

| Field               | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `url`               | Signed GET URL. It stops working 24 hours after the call. |
| `filename`          | The file's name, with the format's canonical extension.   |
| `bytes`             | The file's size.                                          |
| `expires_at`        | When `url` expires (ISO 8601).                            |
| `format`            | The format id written.                                    |
| `minecraft_version` | The Minecraft version written.                            |

The URL can be passed back to the other tools as `url`. A daily cron (`/api/cron/mcp-blob-cleanup`) deletes output files once their URLs have expired (24 hours plus an hour of grace). An expired URL is rejected as an input even before then.

### `list_versions`

The Minecraft versions and output formats the other tools accept.

- Input: none.
- Output: `versions` (every known Minecraft Java version id, oldest first) and `formats` (`{ id, extension }` for each writable format: `Litematic`, `Sponge[v1]`, `Sponge[v2]`, `Sponge[v3]`, `Structure`, `BuildingGadgets[1.12]`, `BuildingGadgets[1.14.4-1.19.3]`, `BuildingGadgets2[1.20+]`, `StructurizeBlueprint`). See [FORMATS.md](../FORMATS.md).

### `list_modpacks`

The modpacks the operator uploaded with `pnpm modpack:upload`, with the refs the block-aware tools take as `modpack`.

- Input: `query` (optional), matched case-insensitively against the slug, the name and their initials (`ATM10` finds `all-the-mods-10`).
- Output: `packs`, each with `slug` (the ref of its latest upload), `name`, `versions` newest first (`{ ref, display_version, minecraft_version, loader, mod_count, uploaded_at }`, `ref` pinned by pack file id, else display version) and, for the newest version, `skipped_mods` (mods per status other than `ok`) and `unsupported_sources` (KubeJS, generated-block mods), or `details_error` when its data can't be read. When nothing is uploaded or nothing matches, `packs` is empty and `note` says so; that isn't a tool error.

### `inspect_schematic`

Reads a schematic and reports what is in it.

- Input: a [schematic input](#schematic-inputs) and an optional `modpack` ref (see `list_modpacks`).
- Output: `format` (detected format id), `minecraft_version`, `size` (`[x, y, z]` of the box enclosing every region), `total_blocks` (non-air blocks), `palette_size` (distinct non-air block states), `palette` (the 30 most common block states, `{ block_state, count }`), `blocks_not_listed` (blocks whose state is not in `palette`) and `regions` (`{ origin, size, blocks }` per region).
- With a `modpack`, each palette row also has `mod` (the pack mod's name, `minecraft` for vanilla, or the namespace of a block the pack lacks), `in_modpack` and, for camo blocks, `camo_materials` (`{ block_state, count, in_modpack }`, `empty` for empty slots). `missing_from_modpack` is `{ block_states, states_not_listed }`: the block states the pack lacks with counts, most common first, at most 50, and how many more there are. A schematic of another Minecraft version is compared after translation to the pack's version: rows whose state translation changed get `translated_state`, and `note` says so.

### `convert_schematic`

Converts a schematic to another format and, optionally, another Minecraft version.

- Input: a [schematic input](#schematic-inputs), `output_format` (a format id), optional `target_version` (defaults to the schematic's own version; Building Gadgets formats move it into their supported range) and an optional `modpack` ref.
- Output: an [output file](#output-files) plus `warnings`: what translating block states between versions lost (for example a block missing from the target version), each prefixed with its source state, and with a `modpack` one line per block state the pack lacks; at most 50 in all plus a line counting the rest. The modpack doesn't change the conversion. A schematic of another Minecraft version than the pack's is compared after translation to the pack's version, and `note` says so.

### `render_schematic`

Draws a schematic as a PNG contact sheet: four isometric views, front, side and top elevations, two plan slices and a cutaway, with flat-coloured blocks (the same sheet as the Advanced Editor's Static Renders tab).

- Input: a [schematic input](#schematic-inputs) and an optional `modpack` ref.
- Output: an `image/png` image content block (longest edge at most 1568 px) and a one-line text summary (name, format, version, size, block and block-state counts, image size).
- Without a `modpack`, mod blocks get a stable colour hashed from their id. With one, mod blocks take the pack's average colour and, when their `kind` isn't `unknown`, that kind's shape (stairs, slabs, fences…); camo blocks take their camo's colour. The summary adds how many block states the pack lacks, with a few examples. States aren't translated to the pack's version here.

### `generate_shape`

Generates a shape of one material with the Shape Generator and writes it as a schematic.

- Input:
  - `shape`: `cuboid`, `ellipsoid`, `dome`, `cylinder`, `cone` or `pyramid`.
  - `width`, `height`, `depth`: size along X, Y and Z, whole numbers from 1 to 256.
  - `axis` (cylinder only): `x`, `y` or `z`, the axis its circular faces are perpendicular to. Defaults to `y`.
  - `hollow`, `thickness`: keep only a shell `thickness` blocks thick (1 to 128, default 1).
  - `material`: a block state such as `minecraft:oak_log[axis=x]` (`minecraft:` may be left off). Use flattened (1.13+) ids for every version; 1.12.2 shapes are written as the material's Forge 1.12 state. Without a `modpack`, mod ids are written as typed. With one, a mod block must be one of the pack's blocks with valid properties (the error names close ids), and a camo frame can hold a camo: `framedblocks:framed_cube{camo=create:brass_block}`, or `{camo=<a>,camo_two=<b>}` for FramedBlocks double blocks (see [Camo blocks](#camo-blocks)).
  - `version`, `output_format`, and an optional `modpack` ref (its Minecraft version must be `version`).
  - `render` (optional): also return a PNG contact sheet (with the pack's colours and shapes when there is a `modpack`).
- Output: an [output file](#output-files) plus `size` (`[x, y, z]`), `block_count`, `block_state` (the material as written) and, for a camo material, `camo` (its `{camo=…}` suffix). With `render`, an `image/png` content block follows the text.

### `search_blocks`

Finds block ids of a Minecraft version, or of a modpack, by name and optionally shape.

- Input: `query` (part of a block name; `minecraft:` may be left off, spaces count as underscores), `version` and/or `modpack`, `shape` (optional, see below) and `limit` (1 to 50, default 20). Without a modpack only `minecraft:` ids are searched. With one, every namespace is: `create:brass` keeps to one mod and `create:` alone lists all of its blocks.
- `shape`: a list of shapes, any of which matches. A shape is a block kind (`block`, `stairs`, `slab`, `wall`, `fence`, `fence_gate`, `pane`, `door`, `trapdoor`, `log`, `carpet`, `button`, `pressure_plate`…, plus `step`, a quarter block that only camo frames such as `create:copycat_step` have) or `full_cube` (fills the whole block space). Mod blocks whose kind is `unknown` only match `full_cube`, and only when they are full cubes.
- Output: `version`, `modpack` (with one), `query`, `results`, `total_matches` (after the shape filter), and, when no name matches, `did_you_mean` (close block names). For 1.12.2, `note` says the ids are flattened (1.13+) names, which the other tools translate when writing 1.12.2 files; `note` also says when names match but none has the shape.
- Each result (exact matches first, then prefix matches, then other matches) is `{ id, kind, mod, shape_confidence, full_cube, hex?, dominant?, variance? }`:

| Field              | Meaning                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`             | The block's shape. For mod blocks it is classified from their properties and model parents when the upload ran, and is `unknown` when the evidence is unclear. Camo frames take the vanilla shape they copy (`framed_stairs` is `stairs`), and other camo blocks are `unknown`. |
| `mod`              | The mod's name, `minecraft` for vanilla blocks.                                                                                                                                                                                                                                 |
| `shape_confidence` | `high`, or `low` when `kind` is `unknown`.                                                                                                                                                                                                                                      |
| `full_cube`        | Whether the block fills the whole block space.                                                                                                                                                                                                                                  |
| `hex`              | Average colour of its textures, when they are known.                                                                                                                                                                                                                            |
| `dominant`         | Up to 3 dominant colours, `{ hex, share }`, largest share first.                                                                                                                                                                                                                |
| `variance`         | Texture variance, 0 for a flat colour to 1 for a busy texture (stone ≈ 0.07, planks ≈ 0.17).                                                                                                                                                                                    |

- With a modpack that has camo frames, `camo_options` and `camo_material_rule` are added when `shape` is given, or when the query ends in a shape word (`brass_stairs`) and no plain block of that shape matches. See [Camo blocks](#camo-blocks).

### `suggest_palette`

Suggests blocks whose average colour is closest to a target colour.

- Input: exactly one of `color` (hex: `#rrggbb`, `rrggbb` or `#rgb`) and `reference_block` (a block id whose colour is the target; it and blocks of exactly its colour are left out), plus `version` and/or `modpack`, `n` (1 to 16, default 8), and either `shape` (as in `search_blocks`) or `full_cube_only` (skip slabs, stairs, plants and other partial blocks; the same as `shape: ["full_cube"]`).
- Output: `version`, `modpack` (with one), `target` (`{ hex, reference_block? }`) and `blocks` (`{ id, kind, mod, shape_confidence, full_cube, hex, dominant?, variance?, distance }`, closest first by OKLab distance; the fields are those of `search_blocks` results). With a modpack, the pack's mod blocks are ranked alongside its vanilla blocks. Each colour is listed once, so a material's stairs, slabs and walls don't crowd out other materials; find them with `search_blocks` or a `shape`. For 1.12.2, `note` as in `search_blocks`.
- With a modpack that has camo frames and a `shape` (or `full_cube_only`), `camo_options` lists frames of that shape holding the camo materials nearest the colour, each with `distance`. See [Camo blocks](#camo-blocks).

### `show_blocks`

Draws blocks as one PNG so an agent can check what they look like instead of trusting their names (`black_terracotta` isn't black; a mod's `brass_block` may be any colour).

- Input: `blocks`, 1 to 16 entries, each a block state (`create:brass_block`, `minecraft:oak_stairs[facing=east]`; unset properties take their defaults) or a camo pair `{ frame, camo }` (`{ "frame": "framedblocks:framed_stairs", "camo": "create:brass_block" }`), plus `version` and/or `modpack`.
- Output: an `image/png` content block, then the JSON below as text and `structuredContent`. Per block the image has a card with two textured isometric views of its shape (from the front-left and the back-right) and its flat top and side faces. The textures are 16×16 face swatches: vanilla ones from the server's bundle, mod ones from the pack's `mod-files/<key>/swatches.png`. Shapes follow the static renders: a mod block's `kind` when it isn't `unknown` (a full cube otherwise), a camo pair the frame's shape with the camo's textures. A block without swatches is drawn in its flat `hex` colour, and `note` says so.
  - `version`, `modpack` (with one).
  - `blocks`: per drawn block `{ id, properties?, mod, kind, hex?, dominant?, variance? }` (fields as in `search_blocks`); a camo pair is its frame's entry plus `camo` (the same fields for the camo material), `writable` and, when not writable, `reason`.
  - `not_found`: `{ id, did_you_mean }` for each id the version or pack lacks; these aren't drawn. Bad properties of a known block, and a `frame` that isn't a camo frame, are tool errors.
  - `camo_material_rule` (`approximate`) with camo pairs, and `note` (for example when a camo material isn't one the server would offer).

Block ids, properties and defaults come from [misode/mcmeta](https://github.com/misode/mcmeta) (1.14 and later) and [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) (1.12.2 and 1.13.x), fetched from jsDelivr the first time a version is used and cached in memory per server instance. `node --experimental-strip-types scripts/check-block-data.mts` checks that every known version loads.

### `compile_build`

Compiles a program in the build language (see [the build language](#build-language)) for one Minecraft version: validation, the compile, post-processing (stair corners, pane, fence and wall connections) and the analysis report. Stateless: send the whole program on every call.

- Input:
  - `program`: the whole program, a JSON object (or the same as a JSON string). `size` is at most 256 on each axis, and a build places at most 2,000,000 blocks.
  - `version`: a version id from `list_versions`. Block ids are flattened (1.13+) names for every version; 1.12.2 builds are compiled against the 1.13.2 block data and written as Forge 1.12 states.
  - `output_format` (optional): also write the build as a schematic in this format.
  - `render` (optional, default `true`): return a PNG contact sheet of the build.
  - `modpack` (optional): compile against the pack's blocks (its Minecraft version must be `version`). Every block id the pack lacks is an error at its program path, with close pack ids. Mod blocks are written namespaced: `create:brass_block` is a block, `create:brass_block[axis=x]` a state; `ns:path` is read as a family and variant (`oak:stairs`) only when `ns:path` isn't a block of the pack. Camo frames take a camo with `<frame>{camo=<block>}` (see [Camo blocks](#camo-blocks)); without a modpack a camo is an error. Post-processing connects mod stairs, fences, panes and walls by their `kind`; a mod block of kind `unknown` is treated as a full block. The render uses the pack's colours and shapes.
- Output, in order:
  - The report as markdown text: `Errors (fix these first)`, `Warnings` and `Auto-repairs / notes`, each line prefixed with the program path of the operation it comes from (`build[2].box.do[0].fill: …`), then `Geometry` (occupied box, connected and FLOATING pieces, sealed rooms), `Features` (doors, windows, stairs, slabs, light sources, BLOCKED DOOR), symmetry and the most used materials.
  - With `output_format`, a text block `{"file": {…}}` holding the [output file](#output-files).
  - Unless `render` is `false`, an `image/png` contact sheet (the same sheet as `render_schematic`).
  - `structuredContent`: `name`, `minecraft_version`, `valid` (false when the program failed validation), `errors`, `warnings`, `notes` (counts), `block_count` and, with `output_format`, `file`.

Problems with the program are not tool errors: they are in the report, and a program with compile errors still renders and writes what it built. A program that fails validation (a bad key, a size over 256…) gets a report of every validation error and no render or file. A `roof` operation reports `roof is not supported yet` at its path. An unknown version, invalid JSON in a string `program`, block data that can't be fetched, a format that can't hold the build (a Building Gadgets format outside the version's range) and `output_format` without a Blob store are tool errors.

### `check_build`

`compile_build` without the render or the file: the same report and `structuredContent` (no `file`) for the same `program`, `version` and `modpack`. Use it for quick checks between revisions.

### Camo blocks

Camo frames (FramedBlocks blocks, Create and Copycats+ copycats) take their look from a block stored in their block entity, so a pack with them can build shapes no mod ships: `framedblocks:framed_stairs` holding `create:brass_block` is brass stairs. With a `modpack`:

- `search_blocks` and `suggest_palette` list `camo_options` when asked for a shape: frames of that shape (only frames that are a camo version of a vanilla shape: cube, stairs, slab, wall, fence, pane, door, trapdoor…, plus `create:copycat_step` as `step`; a query ending in `_step` asks for it) that are among the pack's blocks and have a rule in the server's shape pack for their default state (with the pack jar's own FramedBlocks templates applied). Each option is `{ frame, kind, slots, writable, reason?, camo?, camo_hex?, distance? }`: `slots` is how many camo slots the frame has (2 for FramedBlocks double blocks), `camo` a matching camo material (by name in `search_blocks`, nearest in colour in `suggest_palette`) and `camo_hex` its colour. When no material matches the query, the options have no `camo` and `note` says to pick one.
- Camo materials are approximate (`camo_material_rule: "approximate"`): full-cube blocks of the pack that aren't camo frames or known block-entity blocks. The mods' own checks (tags, config) aren't in the jar data, so the game may refuse some.
- `compile_build`, `check_build` and `generate_shape` write camo with the material syntax `<frame state>{camo=<block state>}`, or `{camo=<a>,camo_two=<b>}` for double blocks (slot 1 takes `camo_two`, else `camo`). The frame is checked first, then each camo like any block of the pack, then against the material rule. `show_blocks` draws `{ frame, camo }` pairs.
- **Writability.** The server writes camo NBT only for the (mod namespace, Minecraft version) pairs in `CAMO_WRITE_VERSIONS` (`src/lib/camo/write-versions.ts`): FramedBlocks on 1.21.1 and 26.1.2, Create and Copycats+ on 1.21.1, the versions with a camo fixture saved in-game by the mod (`src/lib/__tests__/fixtures/CAMO_FIXTURES.md`). For other versions camo options are still listed, with `writable: false` and a `reason`, and writing one is an error.

## Build language

`compile_build` and `check_build` take programs in Schematiclab's build language, a port of the Cairn proof of concept. Its reference is `src/lib/buildlang/SPEC.md`, which the server also offers to clients:

| Kind     | Name                            | What it returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource | `schematiclab://buildlang/spec` | `SPEC.md` word for word (`text/markdown`): program structure, scopes, operations, materials, idioms and the design workflow. Roofs are marked "coming soon".                                                                                                                                                                                                                                                                                                                                                                                   |
| Prompt   | `design_build`                  | Arguments `request` (what to build), `version` (a `list_versions` id) and optional `modpack` (a ref). One user message: the request, an instruction to work plan-first and compile every revision with `compile_build` for that version (and modpack), with a `modpack` the modpack instructions (pass it to every block tool, only use the pack's blocks found with `search_blocks`/`suggest_palette`, check looks with `show_blocks`, use writable `camo_options` for missing shapes), the spec's section 6 (Workflow), then the whole spec. |

The file is read from disk at request time and traced into the MCP route by `outputFileTracingIncludes` in `next.config.ts`.

## Limits

Every limit is in `src/lib/mcp/limits.ts`, and `src/lib/mcp/__tests__/limits.test.ts` exceeds each one.

| Limit                  | Value                               | What happens when it is exceeded                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request size           | 8 MB (`MAX_REQUEST_BYTES`)          | HTTP 413 with a JSON-RPC error, before the body is parsed. 8 MB leaves room for a 5 MB file sent as base64.                                                                                                                                                                                                                                                                  |
| Decoded schematic size | 5 MB (`MAX_INPUT_BYTES`)            | Tool error "The file is larger than the 5 MB limit." Applies to base64, pastebin/gist downloads and Blob URLs.                                                                                                                                                                                                                                                               |
| Decompressed size      | 128 MB (`MAX_DECOMPRESSED_BYTES`)   | Tool error "This schematic decompresses to more than 128 MB, the most this server handles." A gzipped file is inflated once, for both format detection and loading, and inflation stops as soon as it passes 128 MB, so a small file that would expand to gigabytes costs little. 128 MB fits a 2,000,000-block Structure file (about 72 MB), the bulkiest format per block. |
| Blocks per projection  | 2,000,000 (`MAX_PROJECTION_BLOCKS`) | Tool error naming the block count. Applies to parsed schematics and generated shapes (the Shape Generator's own cap). A schematic is checked twice: against its regions' declared sizes (air included) before any block data is decoded, then against its parsed blocks.                                                                                                     |
| Per-tool timeout       | 45 seconds (`TOOL_TIMEOUT_MS`)      | Tool error "… took longer than 45 seconds and was stopped." It stays under the route's `maxDuration` of 60 seconds.                                                                                                                                                                                                                                                          |

The timeout ends a tool while it is waiting on the network or Blob storage. Parsing, writing and rendering run synchronously, so their time is bounded by the decompressed size and block limits instead (a 2,000,000-block shape takes about 20 seconds to write and render), and by the function's `maxDuration` as a last resort. A tool that times out stores no output file: a handler still running when the timeout fires uploads nothing, and an upload already under way is deleted when it lands.

Tool inputs have their own ranges too: `search_blocks` returns at most 50 results, `suggest_palette` at most 16 blocks, `show_blocks` draws at most 16 blocks, `generate_shape` sizes are 1 to 256 per axis, and fetches of block data, modpack data and pastebin/gist files time out after 10 seconds.

## Rate limit

The endpoint has no authentication, so a Vercel Firewall rule limits each client IP. It is configured in the Vercel dashboard (project → **Firewall** → **Configure** → **New Rule**), not in code:

| Setting | Value                                                  |
| ------- | ------------------------------------------------------ |
| If      | Request Path starts with `/api/mcp`                    |
| Then    | Rate Limit, 100 requests per 60-second window          |
| Key     | IP address                                             |
| Action  | Too Many Requests (HTTP 429) once the limit is reached |

An MCP client makes one request per tool call plus a few to connect (initialize, list tools), so 100 requests a minute leaves an agent plenty of room while stopping a single IP from flooding the deploy. The limit was set on 2026-10-04 (SCHEM-92). When changing the rule, update this table.

## Uploading modpacks

Modpacks are uploaded by the operator with a CLI; the MCP server only reads them. It runs every mod jar through the web app's jar parser and uploads derived block data and small face swatches, never jars, textures or models.

```bash
pnpm modpack:upload --instance <dir> [--slug <slug>] [--version <label>]
pnpm modpack:upload --curseforge <slug|id> [--file <id>] [--mods-dir <dir>] [--slug <slug>] [--version <label>]
pnpm modpack:upload --instance <dir> --dry-run --out <dir>
```

| Option                    | Meaning                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--instance <dir>`        | A CurseForge app instance folder (`minecraftinstance.json` + `mods/`) or an unzipped pack export (`manifest.json` + `overrides/mods/`).                                                                          |
| `--curseforge <slug\|id>` | Download a CurseForge modpack (class 4471) by slug or project id, and its mods, into a temporary folder removed at the end. Downloads only go to CurseForge's CDN hosts.                                         |
| `--file <id>`             | With `--curseforge`, the pack file to upload. Defaults to the latest file.                                                                                                                                       |
| `--mods-dir <dir>`        | With `--curseforge`, a mods folder of an installed copy (a server install's will do). Files that can't be downloaded (undistributable or too large) are read from it when a jar has the same file name and size. |
| `--slug <slug>`           | The pack's slug in refs. Defaults to the pack's name, slugified (`All the Mods 10` → `all-the-mods-10`).                                                                                                         |
| `--version <label>`       | The display version. Defaults to the pack's own version.                                                                                                                                                         |
| `--dry-run --out <dir>`   | Write the same files under `<dir>` instead of the Blob store. Needs no credentials.                                                                                                                              |

**Credentials.** The Blob store's credentials come from the environment as for the server: `vercel env pull .env.local` writes them, and the CLI reads `.env.local`. Without them it exits with a message saying so. `--curseforge` also needs `CURSEFORGE_API_KEY` (environment or `.env.local`).

**Mod statuses.** The summary counts every mod by status, and `list_modpacks` reports the non-`ok` ones:

| Status                    | Meaning                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                      | Its blocks are in the pack.                                                                                                                                                                   |
| `no-blocks`               | The jar has no blockstates (a library or a mod without blocks).                                                                                                                               |
| `skipped-undistributable` | `--curseforge` only: the author disallows third-party downloads, so CurseForge gives no download URL. Re-run with `--mods-dir` pointing at an installed copy's `mods/` to include these mods. |
| `skipped-too-large`       | The jar is over the size limit (`CURSEFORGE_MAX_JAR_BYTES` for downloads, default 100 MiB; `--mods-dir` reads it from disk instead).                                                          |
| `failed`                  | The jar is missing or couldn't be read or parsed; the message says why.                                                                                                                       |

The summary also lists blocks registered at runtime that the upload can't see (a `kubejs/` folder, Every Compat, Unlimited Chisel Works), the block count, the bytes written and the ref to use.

**Storage.** Everything goes to the server's private Blob store:

| Path                                         | Contents                                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modpacks/index.json`                        | Every uploaded pack: slug, name, CurseForge project id, and per version its pack file id, display version, Minecraft version, loader, mod count and upload time. Written last.                                                                                        |
| `modpacks/<slug>/<version key>/pack.json.gz` | One record per pack version: its mods (ids, name, namespaces, status) and every mod block (properties with domains and defaults, `kind`, `full_cube`, appearance, swatch rectangles, camo slots). The version key is `cf-<pack file id>`, else `v-<display version>`. |
| `mod-files/<key>/swatches.png`               | Face swatches of one mod file, keyed by CurseForge file id (`cf-<id>`) or the jar's SHA-256, shared between packs and not re-uploaded when already stored. Only `show_blocks` reads them.                                                                             |

Re-uploading the same pack version overwrites its `pack.json.gz` and index entry. The cleanup cron only deletes under `mcp/`, so modpack data is never expired.

## Configuration

The server needs a **private** Vercel Blob store connected to the project, which gives the deploy `BLOB_STORE_ID` and OIDC credentials, and `CRON_SECRET` for the cleanup cron. Locally, run `vercel env pull .env.local`. Without a Blob store, the tools that write files return a tool error saying so, `modpack` refs are a tool error and `list_modpacks` lists nothing; the others still work. See `.env.example`.

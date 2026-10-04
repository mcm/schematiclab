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

Tools that return data return it twice: as `structuredContent` (matching the tool's output schema) and as JSON in a text content block, for clients that only read text.

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

### `inspect_schematic`

Reads a schematic and reports what is in it.

- Input: a [schematic input](#schematic-inputs).
- Output: `format` (detected format id), `minecraft_version`, `size` (`[x, y, z]` of the box enclosing every region), `total_blocks` (non-air blocks), `palette_size` (distinct non-air block states), `palette` (the 30 most common block states, `{ block_state, count }`), `blocks_not_listed` (blocks whose state is not in `palette`) and `regions` (`{ origin, size, blocks }` per region).

### `convert_schematic`

Converts a schematic to another format and, optionally, another Minecraft version.

- Input: a [schematic input](#schematic-inputs), `output_format` (a format id) and optional `target_version` (defaults to the schematic's own version; Building Gadgets formats move it into their supported range).
- Output: an [output file](#output-files) plus `warnings`: what translating block states between versions lost (for example a block missing from the target version), each prefixed with its source state, at most 50 plus a line counting the rest.

### `render_schematic`

Draws a schematic as a PNG contact sheet: four isometric views, front, side and top elevations, two plan slices and a cutaway, with flat-coloured blocks (the same sheet as the Advanced Editor's Static Renders tab).

- Input: a [schematic input](#schematic-inputs).
- Output: an `image/png` image content block (longest edge at most 1568 px) and a one-line text summary (name, format, version, size, block and block-state counts, image size).

### `generate_shape`

Generates a shape of one material with the Shape Generator and writes it as a schematic.

- Input:
  - `shape`: `cuboid`, `ellipsoid`, `dome`, `cylinder`, `cone` or `pyramid`.
  - `width`, `height`, `depth`: size along X, Y and Z, whole numbers from 1 to 256.
  - `axis` (cylinder only): `x`, `y` or `z`, the axis its circular faces are perpendicular to. Defaults to `y`.
  - `hollow`, `thickness`: keep only a shell `thickness` blocks thick (1 to 128, default 1).
  - `material`: a block state such as `minecraft:oak_log[axis=x]` (`minecraft:` may be left off). Use flattened (1.13+) ids for every version; 1.12.2 shapes are written as the material's Forge 1.12 state.
  - `version`, `output_format`.
  - `render` (optional): also return a PNG contact sheet.
- Output: an [output file](#output-files) plus `size` (`[x, y, z]`), `block_count` and `block_state` (the material as written). With `render`, an `image/png` content block follows the text.

### `search_blocks`

Finds block ids of a Minecraft version by name.

- Input: `query` (part of a block name; `minecraft:` may be left off, spaces count as underscores), `version` and `limit` (1 to 50, default 20).
- Output: `version`, `query`, `results` (`{ id, kind }`, exact matches first, then prefix matches, then other matches; `kind` is `block`, `stairs`, `slab`, `wall`, `fence`, `door`, `log`, `pane`…), `total_matches`, and, when nothing matches, `did_you_mean` (close block names). For 1.12.2, `note` says the ids are flattened (1.13+) names, which the other tools translate when writing 1.12.2 files.

### `suggest_palette`

Suggests blocks whose average colour is closest to a target colour.

- Input: exactly one of `color` (hex: `#rrggbb`, `rrggbb` or `#rgb`) and `reference_block` (a block id whose colour is the target; it and blocks of exactly its colour are left out), plus `version`, `n` (1 to 16, default 8) and `full_cube_only` (skip slabs, stairs, plants and other partial blocks).
- Output: `version`, `target` (`{ hex, reference_block? }`) and `blocks` (`{ id, kind, hex, distance, full_cube }`, closest first by OKLab distance). Each colour is listed once, so a material's stairs, slabs and walls don't crowd out other materials; find them with `search_blocks`. For 1.12.2, `note` as in `search_blocks`.

Block ids, properties and defaults come from [misode/mcmeta](https://github.com/misode/mcmeta) (1.14 and later) and [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) (1.12.2 and 1.13.x), fetched from jsDelivr the first time a version is used and cached in memory per server instance. `node --experimental-strip-types scripts/check-block-data.mts` checks that every known version loads.

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

Tool inputs have their own ranges too: `search_blocks` returns at most 50 results, `suggest_palette` at most 16 blocks, `generate_shape` sizes are 1 to 256 per axis, and fetches of block data and pastebin/gist files time out after 10 seconds.

## Rate limit

The endpoint has no authentication, so a Vercel Firewall rule limits each client IP. It is configured in the Vercel dashboard (project → **Firewall** → **Configure** → **New Rule**), not in code:

| Setting | Value                                                  |
| ------- | ------------------------------------------------------ |
| If      | Request Path starts with `/api/mcp`                    |
| Then    | Rate Limit, 100 requests per 60-second window          |
| Key     | IP address                                             |
| Action  | Too Many Requests (HTTP 429) once the limit is reached |

An MCP client makes one request per tool call plus a few to connect (initialize, list tools), so 100 requests a minute leaves an agent plenty of room while stopping a single IP from flooding the deploy. The limit was set on 2026-10-04 (SCHEM-92). When changing the rule, update this table.

## Configuration

The server needs a **private** Vercel Blob store connected to the project, which gives the deploy `BLOB_STORE_ID` and OIDC credentials, and `CRON_SECRET` for the cleanup cron. Locally, run `vercel env pull .env.local`. Without a Blob store, the tools that write files return a tool error saying so; the others still work. See `.env.example`.

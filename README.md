# Schematiclab

Convert Minecraft schematics between formats and Minecraft versions in your browser. Parsing, translation and export run client-side in a Web Worker, so your schematic never leaves your machine.

## Features

- **Simple Mode:** drop a file (or import one from a pastebin.com or gist.github.com URL), pick an output format and target version, and download the result.
- **Advanced Editor:**
  - 3D preview
  - material list
  - block swaps with undo
  - a preview of what version translation will change before you apply it
- **Modded blocks:** search CurseForge and load a mod so its blocks render in the preview and appear in the block picker. Only the mod's client assets (blockstates, models, textures, names) are read, and no mod code is ever run. Loaded mods are cached in IndexedDB.
- **Camo blocks:** FramedBlocks, Create and Copycats+ blocks render in their shape with their camo's textures, and their camo materials appear in the material list, where you can swap them. See [Camo blocks](#camo-blocks).

## Camo blocks

Camo blocks copy the look of another block (their "camo") that is stored in their block-entity data. Load the mod in the Mods tab and the preview renders each camo block in its real shape with its camo's textures. The "Show camo" toggle switches between camos and empty frames. Camo materials are listed under their block in the material list and can be swapped for one block or all of them, and version conversion translates the camo states too.

| Mod          | Minecraft version | Shapes                                                                                |
| ------------ | ----------------- | ------------------------------------------------------------------------------------- |
| FramedBlocks | 26.1.2            | Every block type, including slopes, slope edges, prisms, slope slabs and slope panels |
| Create       | 1.21.1            | Copycat step, panel and bars                                                          |
| Copycats+    | 1.21.1            | Every copycat, including slopes, vertical slopes and other rotated shapes             |

The shapes come from shape packs in `public/camo-shapes/` that are generated from each mod's source (see [NOTICE.md](public/camo-shapes/NOTICE.md) for credits and licenses). Schematics saved with other versions of these mods still render when their block states match, and blocks or states without shape data fall back to a full cube of the empty-frame texture.

Known limits:

- No connected textures: a camo with connected textures (Create's `EnableCT`, or a connected-textures mod) renders each block on its own.
- No overlays: FramedBlocks overlays such as reinforcement, glowing or intangibility are not drawn.
- No animation: animated camo textures (such as water, lava or magma) show their first frame.
- FramedBlocks' fancy rail slopes render only their camo sleepers, not the rails, as on the flat fancy rails. The plain rail slopes render the vanilla rail on top.

## Supported formats

| Format                                        | Extension    |
| --------------------------------------------- | ------------ |
| Litematic                                     | `.litematic` |
| Sponge (v1, v2, v3)                           | `.schem`     |
| Structure (vanilla and Create)                | `.nbt`       |
| Building Gadgets (1.12, 1.14.4–1.19.3, 1.20+) | `.txt`       |
| Structurize Blueprint                         | `.blueprint` |

Every format can be both read and written. See [FORMATS.md](FORMATS.md) for detection ids and output rules.

Block states are translated between Minecraft versions from 1.12.2 upward, including the 1.12 → 1.13 flattening and Forge 1.12 block variants. A translation that loses information (for example, a block that doesn't exist in the target version) is reported as a warning.

## Development

Requires Node 22 and pnpm. Installing dependencies needs access to the private `@iamthemcmaster/ui` package on npm.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

| Command          | Purpose                       |
| ---------------- | ----------------------------- |
| `pnpm build`     | Production build (standalone) |
| `pnpm start`     | Serve the production build    |
| `pnpm test`      | Run the Vitest suite          |
| `pnpm lint`      | ESLint                        |
| `pnpm typecheck` | `tsc --noEmit`                |
| `pnpm format`    | Format with Prettier          |

### Configuration

Copy `.env.example` to `.env.local`. The CurseForge settings are only needed for the Mods tab:

- `CURSEFORGE_API_KEY`: a key from [console.curseforge.com](https://console.curseforge.com). It is used only on the server and never sent to the browser. Escape each `$` in the key as `\$`. Without a key, the Mods tab is unavailable.
- `CURSEFORGE_MAX_JAR_BYTES`: the largest mod jar the download proxy will fetch (default 64 MiB).

### Regenerating data

The generated data files are checked in, so these are only needed when updating the data they are built from. They expect local checkouts of [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) and [misode/mcmeta](https://github.com/misode/mcmeta):

- `pnpm gen:translations` regenerates the block-state translation tables.
- `pnpm gen:mc-assets` rebuilds the vanilla textures and models used by the 3D preview (`public/minecraft-assets/`).
- `node --experimental-strip-types scripts/regenerate-known-versions.mts` regenerates the list of known Minecraft versions.

## Credits

- Block translation data: [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) and [misode/mcmeta](https://github.com/misode/mcmeta).
- 3D rendering: [deepslate](https://github.com/misode/deepslate).
- Camo shapes: generated from [FramedBlocks](https://github.com/XFactHD/FramedBlocks) by XFactHD (LGPL-3.0), [Copycats+](https://github.com/copycats-plus/copycats) (all rights reserved, used with its author's permission) and [Create](https://github.com/Creators-of-Create/Create) (MIT). See [public/camo-shapes/NOTICE.md](public/camo-shapes/NOTICE.md).

## License

[MIT](LICENSE)

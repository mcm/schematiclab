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

## License

[MIT](LICENSE)

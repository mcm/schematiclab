# Schematic Formats

Canonical file extensions and production-availability rules for every schematic format Schematiclab handles. This file is the source of truth — UI dropdowns, download filenames, and tests should all reference these values.

## Mapping

| Format family                   | schemlib detection id(s)                                                             | Canonical extension | Production output? |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------------- | ------------------ |
| Litematic                       | `Litematic`                                                                          | `.litematic`        | Yes                |
| Sponge                          | `Sponge[v1]`, `Sponge[v2]`, `Sponge[v3]`                                             | `.schem`            | Yes                |
| Structure (Create + vanilla MC) | `Structure`                                                                          | `.nbt`              | Yes                |
| Building Gadgets                | `BuildingGadgets[1.12]`, `BuildingGadgets[1.14.4-1.19.3]`, `BuildingGadgets2[1.20+]` | `.txt`              | Yes                |
| Structurize Blueprint           | `StructurizeBlueprint`                                                               | `.blueprint`        | Yes                |
| schemlib JSON (intermediate)    | `JSON`                                                                               | `.json`             | **No — dev only**  |

## Rules

- **One canonical extension per family.** Even when a format has multiple wire versions (e.g. Sponge v1/v2/v3, Building Gadgets v0/v1/v2), the file extension does not change.
- **Detection ids** come from `src/lib/schemlib/schematic-formats/detect.ts` (`detectSchematicType`). Treat these strings as stable identifiers throughout the app.
- **schemlib JSON is dev-only.** The `.json` intermediate format is useful for inspection and debugging but is not a user-facing output. It MUST be hidden from any production UI dropdown. Detection of `.json` input MAY still be supported in production (so users can re-import an exported intermediate), but production builds MUST NOT offer it as an output choice.
- **Filename derivation.** Strip the original extension from the input filename, then append the canonical extension above. (E.g. `castle.litematic` exported as Sponge → `castle.schem`.)


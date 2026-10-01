# Camo fixtures

Vanilla structure files (`.nbt`) with camo blocks from FramedBlocks, Create and
Copycats+. The mods saved them in-game, so the block-entity NBT is what each
mod actually writes. Both mod authors gave permission to use them (SCHEM-33).

`pnpm gen:camo-fixture-datapacks` (`scripts/generate-camo-fixture-datapacks.mts`)
writes the two datapacks that place the blocks. Each pack's README has the
in-game steps. Every function places one plate, and a structure block saves it
as `<function name>.nbt`. A fixture that needs more than one 48×48 plate gets
numbered functions (`framed_covered_1` … `framed_covered_4`).

## Files

| File                                    | Datapack function                                     | Story                    | DataVersion   | Mods                                         |
| --------------------------------------- | ----------------------------------------------------- | ------------------------ | ------------- | -------------------------------------------- |
| `framed_slopes_1.nbt`, `_2`             | `schematiclab:framed_slopes_1`, `_2`                  | US-014 (SCHEM-47)        | 4790 (26.1.2) | FramedBlocks 11.4.0 @ 8267f80                |
| `framed_slope_slabs_panels_1.nbt`, `_2` | `schematiclab:framed_slope_slabs_panels_1`, `_2`      | US-015 (SCHEM-48)        | 4790 (26.1.2) | FramedBlocks 11.4.0 @ 8267f80                |
| `framed_covered_1.nbt` … `_4`           | `schematiclab:framed_covered_1` … `_4`                | US-006/US-013 regression | 4790 (26.1.2) | FramedBlocks 11.4.0 @ 8267f80                |
| `copycats_shapes.nbt`                   | `schematiclab:copycats_shapes`                        | US-008 (SCHEM-43)        | 3955 (1.21.1) | Copycats+ @ 60923e0, Create 6.0.11 @ fc9535d |
| `copycats_slopes.nbt`                   | `schematiclab:copycats_slopes`                        | US-016 (SCHEM-49)        | 3955 (1.21.1) | Copycats+ @ 60923e0, Create 6.0.11 @ fc9535d |
| `framed_blocks_minimal_nbt.nbt`         | none: a 2×2 sample saved before the datapacks existed | –                        | 3955 (1.21.1) | FramedBlocks (version not recorded)          |
| `copycats_nbt.nbt`                      | none: a 3×2 sample saved before the datapacks existed | –                        | 3955 (1.21.1) | Copycats+ and Create (versions not recorded) |

The FramedBlocks pack runs on Minecraft 26.1.2 (NeoForge), and the Copycats+
pack on 1.21.1 (NeoForge) with Create. FramedBlocks states come from the
checkout's Java and the shape pack's rules. Copycats states are hand-written in
`scripts/camo-fixtures/copycats-specs.ts`.

## Layout

- Blocks sit on a 2-block grid, one row per block type. A row that doesn't fit
  on one line wraps onto more lines, and short rows can share a line with one
  empty cell between them.
- **The last block in each row has no camo.** FramedBlocks saves it as
  `camo:{type:"framedblocks:empty"}` (doubles also get an empty `camo_two`).
  Single-state copycats save `Material:{Name:"create:copycat_base"}` with an
  empty `Item`. Multi-state copycats save each part as
  `material:{Name:"create:copycat_base"}` with `consumedItem:{}`. Every other
  block has a camo.
- Doors take two blocks; the upper half sits on top of the lower one.
- Multi-state copycats alternate two materials across their parts so each
  part's material shows.

## Generated tables

`pnpm gen:camo-block-states` reads the datapack fixtures (not the two older
samples) and writes the app's tables of camo blocks, FramedBlocks double
blocks and camo block properties (`src/lib/camo/*.generated.ts`). Re-run it
whenever the fixtures are re-saved; `block-tables.fixtures.test.ts` fails
when the tables and the fixtures disagree.

## Checked against the placements

Every saved block state was checked against what the datapack placed
(2026-09-30):

| Fixture                         | Matched     |
| ------------------------------- | ----------- |
| `copycats_shapes`               | 326/326     |
| `copycats_slopes`               | 53/53       |
| `framed_slopes_1-2`             | 500/500     |
| `framed_slope_slabs_panels_1-2` | 814/814     |
| `framed_covered_1-4`            | 1,341/1,347 |

### Known gap

The 6 misses in `framed_covered_1-4` are all `framedblocks:framed_chest` with
`state=closing`: the datapack placed them, but they were saved as
`state=closed`. Tests can't rely on a `closing` chest being in these fixtures.

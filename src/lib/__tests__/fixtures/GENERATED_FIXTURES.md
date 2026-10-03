# Generated-block fixtures

Vanilla structure files (`.nbt`) with blocks that mods register at runtime
(see "Generated blocks" in `CLAUDE.md`). The mods placed and saved them
in-game, so the block ids and states are what each mod actually writes.

## Files

| File             | Function                   | Story              | DataVersion   | Mods                                                    |
| ---------------- | -------------------------- | ------------------ | ------------- | ------------------------------------------------------- |
| `ucw_1_12_2.nbt` | `schematiclab:ucw_fixture` | US-008b (SCHEM-82) | 1343 (1.12.2) | Unlimited Chisel Works 0.3.5, Chisel, Natura, Env. Mat. |

There is no `ucw_1_12_2.litematic`: Litematica wasn't available for the 1.12.2
instance, so only the structure-block save exists.

### Mods used (SCHEM-82)

Minecraft 1.12.2, Forge:

- `UnlimitedChiselWorks-0.3.5.jar`
- `Chisel-MC1.12.2-1.0.2.45.jar`
- `CTM-MC1.12.2-1.0.2.31.jar`
- `natura-1.12.2-4.3.2.69.jar` (with `Mantle-1.12-1.3.3.55.jar`)
- `environmentalmaterials-1.12.2-1.0.20.1.jar` (with
  `valkyrielib-1.12.2-2.0.20.1.jar`)
- `LunatriusCore-1.12.2-1.2.0.42-universal.jar`

## Layout

`pnpm gen:ucw-fixture-functions` (`scripts/generate-ucw-fixture-functions.mts`,
layout in `scripts/ucw-fixtures/layout.ts`) places every rule of UCW's bundled
`ucwdefs/chisel/natura.json` and `environmentalmaterials.json`, relative to
where the function runs:

- **y**: one layer per rule, in file order: `chisel:planks-oak` through
  `natura:nether_planks` (y=0) and `natura:overworld_planks` (y=1), then
  `chisel:stonebrick`, `stonebrick1` and `stonebrick2` through
  `environmentalmaterials:alabaster_bricks` (y=2–4).
- **z**: one row per `from` metadata, 0–15.
- **x = 0**: the `from` block at that metadata (`setblock … <from> <meta>`).
  It is the ground truth for the UCW blocks of its row.
- **x = 1–16**: the UCW block `<through>_<from>_<meta>` at data value
  (Chisel `variation`) 0–15.

What the game saved where the commands didn't fit:

- Rows past a `from` block's last metadata (Natura's nether planks have 4
  types, overworld planks 9) have no UCW block, since UCW registers none, and
  their x=0 block holds the `from` block's default state. Only rows with UCW
  blocks are ground truth.
- Data values past a Chisel block's variations: `chisel:planks-oak` (15) and
  `stonebrick2` (10) save the last variation again, `stonebrick1` (10) leaves
  air.

## Coverage test

`src/lib/mods/generated/__tests__/ucw-fixture-coverage.test.ts` parses the
fixture with hand-written rules and a synthetic loaded-file set (no jars or
`ucwdefs` files), resolves every `unlimitedchiselworks:` placement and checks
the resolved `from` state against the row's x=0 block. A mismatch is fixed with
an entry in `src/lib/mods/generated/ucw/meta-overrides.ts` naming the fixture,
never by loosening the test. Natura's planks match the blockstate-order guess;
Environmental Materials' alabaster bricks use dye metadata order (override).

## Re-saving

1. Update the UCW checkout (`UCW_PATH`, `~/projects/UnlimitedChiselWorks` or
   `../UnlimitedChiselWorks`) and run `pnpm gen:ucw-fixture-functions`.
2. Follow `build/ucw-fixture-functions/README.md`: install the function in a
   1.12.2 world with the mods above, run `/function schematiclab:ucw_fixture`,
   and press SAVE on the structure block it places (`ucw_1_12_2`).
3. Copy `<world>/structures/ucw_1_12_2.nbt` here, update the table and mod list
   above, add any new rule layers to the test's hand-written rules, and run
   `pnpm test`.

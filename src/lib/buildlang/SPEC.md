# Schematiclab build language — reference

The build language describes a Minecraft Java build as a JSON program. You describe **design**:
which volumes exist, how they are subdivided, which material _role_ goes where. The compiler
handles **geometry**: exact coordinates, block states, stair orientation, pane/fence/wall
connections, symmetry of repeats, and bounds. Never list individual blocks when an operation
can express the intent.

A program is compiled for one Minecraft version (any version `list_versions` returns). Block
names and states are checked against that version's blocks. Always write flattened (1.13+)
block ids, even for 1.12.2: 1.12.2 builds are translated to their 1.12 block states when the
schematic is written.

## 1. Program

```json
{
  "name": "Stone cottage",
  "size": [17, 16, 13],
  "seed": 1,
  "palette": {
    "wall": "stone_bricks",
    "roof": "spruce",
    "door": "spruce",
    "window": "glass_pane"
  },
  "templates": { "window_bay": [ ... ] },
  "build": [ ...operations... ]
}
```

- `size` — `[width(x), height(y), depth(z)]`, the hard bounds: whole numbers, at most 256 on
  each axis. Blocks outside are dropped with a warning. A build may place at most 2,000,000
  blocks. Leave room for roof overhangs (usually 1–2 blocks each side).
- `seed` — an integer; changes `mix` textures and `choose` picks. Same program and seed ⇒
  same build.
- `palette` — role name → material. Refer to roles as `"@wall"`. Always use roles for anything
  that repeats so the style can be changed in one place.
- `templates` — named operation lists, invoked with `use`.
- `build` — list of operations executed in the root scope.

No other top-level keys are allowed.

## 2. Coordinates and scopes

World axes: **+x = east, +y = up, +z = south.** Every operation runs inside a _scope_: an
oriented box with its own local x/y/z starting at 0. All positions and directions you write
are **local to the current scope**.

A box's **front is its +z side**; left is −x, right is +x (as seen by someone standing in front
of it). A face scope (from `faces`) has local x running left→right _as seen from outside_,
y up, and z pointing _into_ the building (z = 0 is the outer surface).

Within a layer, later operations overwrite earlier ones and `"air"` erases. Layers
(section 3a) decide what wins when features overlap.

### Lengths and positions

| Form                                            | Meaning                                      |
| ----------------------------------------------- | -------------------------------------------- |
| `5`                                             | 5 blocks (whole numbers only)                |
| `-3` (positions only)                           | 3 from the far end (`-1` = last block)       |
| `"50%"`                                         | percentage of the parent's size on that axis |
| `"~"` (box sizes)                               | the rest of the parent after `at`            |
| `"~2"` (split parts only)                       | a weighted share of the remainder            |
| `"center"`, `"start"`, `"end"` (positions only) | align the child within the parent            |

## 3. Operations

Each operation is an object with exactly one operation key. Keys starting with `#` are
comments and can appear anywhere (`{"#": "chimney", "box": {...}}` is fine inside argument
objects). Every list of operations must be a JSON list, and unknown keys in argument objects
are errors.

### 3a. Layers: `priority` and `carve`

Any operation's argument object may carry `"priority": n` (integer, default 0) and
`"carve": true`. Both are inherited by everything nested inside it.

- A block overwrites blocks from its own or lower layers, **regardless of program order**.
- Air only erases blocks from its **own** layer, so a high-priority feature never punches
  holes in lower layers. With `"carve": true`, air cuts through every layer (skylights,
  doorways through another feature's wall).
- `only_empty` and `replace` are judged against the cell as composed from lower layers and
  earlier writes.

```json
{
  "box": {
    "at": [1, 1, 1],
    "size": [2, 16, 2],
    "priority": 1,
    "do": [{ "fill": "bricks" }]
  }
}
```

### Scope operations

**`box`** — child scope.
`{"box": {"at": [x,y,z], "size": [w,h,d], "rotate": 0-3, "do": [...]}}`
Defaults: `at` `[0,0,0]`, `size` `["~","~","~"]`. `rotate` turns the child's axes by quarter
turns clockwise seen from above (1: its front faces west, 2: north, 3: east). `size` is in
the child's own axes; the child's footprint still starts at `at`, so you never compute a
rotated origin. Use rotation for wings whose entrances should face another way.

**`split`** — divide along one axis (CGA split).
`{"split": {"axis": "y", "parts": [{"size": 1, "do": [...]}, {"size": "~", "do": [...]}]}}`
Part sizes: integer, `"N%"`, `"~"` or weighted `"~2"` (weights share the remainder).
A part without `do` just reserves space.

**`repeat`** — tile along one axis.
`{"repeat": {"axis": "x", "every": 3, "gap": 1, "do": [...]}}`
Options: `every` (tile size), `gap` (space between tiles), `count` (force a count),
`margin` (minimum space at each end), `align` (`center` default, `start`, `end`, `stretch`).
Per-tile variation: `pattern` (list of op-lists, cycled), `first`, `last`, `ends`.
Tile count = ⌊(L − 2·margin + gap) / (every + gap)⌋, and leftover space is split between the
ends. **For perfect symmetry, make the leftover even** (the compiler warns when it isn't).

**`inset`** — shrink the scope.
`{"inset": {"by": 1, "do": [...]}}` insets x and z on both sides (y unchanged).
Or give sides: `{"by": {"x": 1, "top": 2, "front": 0, "left": 1, "right": 1, "back": 0, "bottom": 0}}`
(`x`, `y`, `z` set both ends of that axis).

**`faces`** — operate on the faces of the current box (CGA comp(f)).
`{"faces": {"sides": [...], "front": [...], "back": [...], "left": [...], "right": [...],
"top": [...], "bottom": [...], "edges": [...], "thickness": 1}}`
Order: `sides` runs on all four walls, then named faces (overriding `sides`), then `top`/`bottom`,
then `edges` (the four vertical corner columns: pillars, quoins, timber posts).
Face width: front/back = box width, left/right = box depth. Corners belong to both adjacent faces.

### Material operations

**`fill`** — `{"fill": "@wall"}` or
`{"fill": {"material": "@window", "replace": "@wall", "only_empty": false, "facing": "out", "axis": "x", "half": "top", "state": {...}}}`

- `replace` — only overwrite these materials (block ids, roles, mixes, a list of them, or
  `"solid"` for any non-air). Use it to punch windows through curved walls.
- `only_empty` — only place into air.

**`clear`** — `{"clear": true}` (fill with air).

**`frame`** — fill only the 12 edges of the box: `{"frame": "@beam"}`. Logs are oriented along each edge automatically.

**`block`** — one block: `{"block": {"at": [x,y,z], "material": "lantern", "facing": "+z", "state": {"hanging": "true"}}}`.
If it lands on (or is later overwritten by) a solid block from another operation, the report
warns. Doors, trapdoors and wall torches set into solid walls are exempt. Keep furniture
coordinates clear of chimneys, stairs and walls; remember that beds and doors take two cells.

**`door`** — `{"door": "@door:door"}` or `{"door": {"material": "...", "x": 1, "hinge": "left"}}`.
Clears a 1×2 opening at the bottom centre of the scope (z = 0) and places the door facing
inward. Intended for a face tile. Without a material it uses `"@door"` (so define a `door` role).

**`cylinder`** / **`ellipsoid`** — fitted to the scope: `{"cylinder": {"material": "@wall", "hollow": true, "thickness": 1}}`.
Hollow walls are watertight. Cylinders are vertical; an ellipsoid fills the whole box.

### Roofs (coming soon)

**`roof`** is not supported yet: a `roof` operation compiles to the error
`roof is not supported yet` at its path, and the rest of the program still builds. Until roofs
arrive, build a flat top with `fill` or `split`, or leave the space above the walls empty.

### Composition

**`use`** — run a template in the current scope: `{"use": "window_bay"}` or
`{"use": {"name": "facade", "with": {"bays": [...], "glass": "@window"}}}`.
In the template body, a value `"$bays"` is replaced by the parameter (any JSON value). So is
a key `"$face"` (when the parameter is a string), and `"${glass}"` inside longer strings
(string or number parameters; the result is always a string, so pass numbers such as sizes
as whole `"$n"` values). A `$name` with no such parameter is an error. Templates may use
other templates, at most 32 deep.

**`choose`** — seeded random pick: `{"choose": {"options": [[...], [...]], "weights": [3, 1]}}`
or just a list of options.

**`when`** — branch on scope size: `{"when": {"min": [5, null, null], "do": [...], "else": [...]}}`
(`min`/`max` per local axis, `null` skips that axis).

## 4. Materials

| Form                   | Example                                                      |
| ---------------------- | ------------------------------------------------------------ |
| block id               | `"stone_bricks"` (`minecraft:` may be left off)              |
| block id with states   | `"oak_stairs[facing=out,half=top]"`                          |
| palette role           | `"@wall"`                                                    |
| role + variant         | `"@roof:slab"`, `"@door:door"`, `"@trim:wall"`               |
| family + variant       | `"spruce:stairs"`, `"stone_bricks:wall"`, `"dark_oak:fence"` |
| weighted mix (texture) | `{"mix": {"cobblestone": 3, "mossy_cobblestone": 1}}`        |
| nothing                | `"air"` (erases, see section 3a)                             |

- Variants: `block`, `stairs`, `slab`, `wall`, `fence`, `fence_gate`, `door`, `trapdoor`, `log`, `pillar`, `button`, `pressure_plate`.
- A wood name (`"spruce"`) as a role means its planks; `"spruce:log"` is the log.
- If a variant or block doesn't exist in the target version, a sensible fallback is used and
  noted in the report (for example a wood that is newer than the version). Misspelt names are
  repaired when the intent is clear, and noted; otherwise they are errors with suggestions.
- States are checked against the version: an invalid value of a real property is an error,
  and a state the block doesn't have is ignored with a note.

**Directions in states are local.** `facing` accepts `+x`, `-x`, `+z`, `-z`, `up`, `down`.
In face scopes it also accepts `in`, `out`, `left`, `right`. `axis` accepts local `x`/`y`/`z`.

Automatic states:

- Logs in 1-thick horizontal runs lie along the run.
- Doors in faces face inward; wall torches and trapdoors face outward.
- Doors and beds place both halves.
- Stairs form corner shapes; panes, fences and walls connect to their neighbours.

States you set yourself win over automatic ones.

## 5. Idioms

**Storeys** — split y: foundation, walls, floor layer, walls, then space for the roof.

```json
{
  "split": {
    "axis": "y",
    "parts": [
      {
        "size": 1,
        "do": [
          { "fill": "@foundation" },
          { "inset": { "by": 1, "do": [{ "fill": "@floor" }] } }
        ]
      },
      {
        "size": 4,
        "do": [
          {
            "faces": {
              "sides": [{ "use": "facade" }],
              "edges": [{ "fill": "@trim" }]
            }
          }
        ]
      },
      { "size": "~" }
    ]
  }
}
```

**Symmetric window bays with posts between them** (face width W):

```json
{"fill": "@wall"},
{"repeat": {"axis": "x", "every": 1, "gap": 3, "do": [{"fill": "@post"}]}},
{"box": {"at": [0, 1, 0], "size": ["100%", 3, 1], "do": [
  {"repeat": {"axis": "x", "every": 3, "gap": 1, "do": [
    {"box": {"at": [1, 0, 0], "size": [1, 2, 1], "do": [{"fill": "@window"}]}}]}}]}}
```

Posts land at 0, 4, 8, … and windows at 2, 6, 10, …. Choose W = 4k+1 (9, 13, 17, 21) so
posts hit both corners and everything is symmetric.

**Door in the middle bay**: use `"pattern": [[window], [door], [window]]` on the bay repeat,
with as many entries as there are tiles.

**Windows through a round wall**: a thin box across the tower with
`{"fill": {"material": "@window", "replace": "@wall"}}`.

**Wing with its own entrance direction**: `box` with `rotate`, then build it exactly like a
normal house (its `front` face follows the rotation). Remember that `size` is in the wing's
own axes: with `rotate: 1`, a wing 7 wide (world x) and 9 deep (world z) has
`"size": [9, h, 7]`.

**Feature through another feature's wall**: give it a higher `priority`; to cut an opening
on purpose, use `carve`.

**Floor that must not overwrite walls**: `inset` by 1 first, or use `only_empty`.

## 6. Workflow

1. **Plan first**, in a few sentences: footprint, storeys, palette, key features, and
   the dimensions that make repeats symmetric.
2. Write the program. Prefer roles, templates and repeats over hand-placed blocks.
3. Compile it with `compile_build` (or `check_build` for the report alone). You will receive a
   report and a contact sheet. The sheet contains four iso views (one per corner), front,
   side and top elevations, two floor plans and a cutaway.
4. **Fix ERRORS first**, then warnings, then design issues. Errors, warnings and notes name
   the program path of the operation they come from (`build[2].box.do[0].fill`); findings
   give real coordinates. Watch for: FLOATING pieces, BLOCKED DOOR, no sealed interior,
   dropped out-of-bounds blocks, collisions (a placed `block` sharing a cell with another
   feature, e.g. a bed inside a chimney), and low symmetry when the design should be symmetric.
   Enclosure is checked at half-block resolution, so gaps through the open half of a stair
   or slab count as leaks.
5. Revise by sending the **complete** program again, not a diff. When it is right, compile it
   with an `output_format` to get the schematic file.

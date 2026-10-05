# Cairn golden fixtures

Data from the Cairn proof of concept, used as golden test data. No Cairn code
is included.

- `{cottage,manor,tower}.json`: Cairn's example programs (`examples/`).
  Prettier reformats them; their contents are unchanged.
- `{cottage,manor,tower}.schem`: the builds Cairn compiled from them
  (`samples/`, Sponge v2, Minecraft 1.21.4), byte for byte.
  `../../cairn-examples.test.ts` compiles each program for 1.21.4 and checks
  it matches its `.schem` cell for cell and state for state, with blocks from
  the same `mix` treated as equal.
- `single-roofs.json` and `merged-roofs.json`: roof programs and the blocks
  Cairn's roof engine produced for them, used by `../../roofs.test.ts` and
  `../../roof-merging.test.ts`.

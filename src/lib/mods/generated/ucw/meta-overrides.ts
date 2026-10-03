// Exact 1.12 metadata order of `from` (and `through`) blocks, where the
// heuristic in `resolve.ts` guesses wrong.
//
// A UCW block id ends in its `from` state's metadata, which only the `from`
// mod's Java knows (`getMetaFromState`). Without an entry here, `resolve.ts`
// assumes meta `i` is the `i`-th state in the order the block's blockstate JSON
// lists its variant values (and flags the result `approximate`). Add an entry
// when a fixture saved in-game shows a different `from` state for a meta than
// that guess (the fixture-coverage test reports the mismatch), or when a mod's
// source shows the order. Entries are exact: resolutions using them are not
// approximate.
//
// Key: namespaced block id. Value: index = metadata, each entry the state's
// properties as `prop=value,prop=value` ("" for a stateless block), or null
// for a metadata value with no state.

export const UCW_META_OVERRIDES: Readonly<
  Record<string, readonly (string | null)[]>
> = {
  // Dye metadata order, as saved in-game in ucw_1_12_2.nbt (Environmental
  // Materials 1.0.20.1, GENERATED_FIXTURES.md).
  "environmentalmaterials:alabaster_bricks": [
    "color=white",
    "color=orange",
    "color=magenta",
    "color=light_blue",
    "color=yellow",
    "color=lime",
    "color=pink",
    "color=gray",
    "color=silver",
    "color=cyan",
    "color=purple",
    "color=blue",
    "color=brown",
    "color=green",
    "color=red",
    "color=black",
  ],
};

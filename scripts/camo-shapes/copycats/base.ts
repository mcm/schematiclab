// Copycats+ `foundation/copycat/model/CopycatModelCore.java`, the base of
// every core, ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f.
//
// The base registers the material as the only model entry and leaves
// `emitCopycatQuads` abstract. `copycats:wrapped_copycat` (a render-time
// stand-in for other copycats, `WrappedCopycatBlock`) registers no core of
// its own, so it maps to the full-cube spec like CopycatBlockModelCore.

import { type CopycatBlockSpec, type ModelCore } from "./assembly.ts";

/** CopycatModelCore with the trivial `assembleAll()` body. */
export const CopycatModelCore: ModelCore = {
  emitCopycatQuads(_key, _state, context) {
    context.assembleAll();
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:wrapped_copycat": { core: CopycatModelCore, properties: {} },
};

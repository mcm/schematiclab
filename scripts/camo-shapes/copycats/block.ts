// Copycats+ `content/copycat/block/`: CopycatBlockModelCore, ported from
// copycats-plus/copycats at commit 60923e001d931ccbc2c6b21b0e911a248375186f.

import { type CopycatBlockSpec, type ModelCore } from "./assembly.ts";

/** CopycatBlockModelCore: assembles the camo without any modifications. */
export const CopycatBlockModelCore: ModelCore = {
  emitCopycatQuads(_key, _state, context) {
    context.assembleAll();
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_block": {
    core: CopycatBlockModelCore,
    properties: {},
  },
};

// Copycats+ `content/copycat/ghost_block/`: CopycatGhostBlockModelCore,
// ported from copycats-plus/copycats at commit
// 60923e001d931ccbc2c6b21b0e911a248375186f.

import { type CopycatBlockSpec, type ModelCore } from "./assembly.ts";

/** CopycatGhostBlockModelCore: assembles the camo without any modifications. */
export const CopycatGhostBlockModelCore: ModelCore = {
  emitCopycatQuads(_key, _state, context) {
    context.assembleAll();
  },
};

export const BLOCKS: Readonly<Record<string, CopycatBlockSpec>> = {
  "copycats:copycat_ghost_block": {
    core: CopycatGhostBlockModelCore,
    properties: {},
  },
};

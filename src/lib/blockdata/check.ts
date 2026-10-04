// The loop behind `scripts/check-block-data.mts`: load block data for every
// KNOWN_VERSIONS key and collect the failures.

import { KNOWN_VERSIONS } from "../schemlib/schematic-formats/known-versions.ts";
import { type BlockDataDeps, loadBlockData } from "./load.ts";

export interface BlockDataCheckFailure {
  version: string;
  error: string;
}

export async function checkAllBlockData(
  deps: BlockDataDeps,
  log: (line: string) => void = () => {},
  versions: readonly string[] = Object.keys(KNOWN_VERSIONS),
): Promise<BlockDataCheckFailure[]> {
  const failures: BlockDataCheckFailure[] = [];
  for (const version of versions) {
    try {
      const data = await loadBlockData(version, deps);
      log(
        `ok   ${version}: ${data.blocks.size} blocks from ${data.sourceVersion}`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ version, error });
      log(`FAIL ${version}: ${error}`);
    }
  }
  return failures;
}

// Load block data for every KNOWN_VERSIONS key with the real fetch and print
// the failures. Not run in CI (it uses the network); run it by hand after
// adding a version:
//   node --experimental-strip-types scripts/check-block-data.mts

import { checkAllBlockData } from "../src/lib/blockdata/check.ts";

const failures = await checkAllBlockData({ fetch }, (line) =>
  console.log(line),
);
if (failures.length > 0) {
  console.error(`\n${failures.length} version(s) failed:`);
  for (const { version, error } of failures) {
    console.error(`  ${version}: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("\nEvery known version loaded.");
}

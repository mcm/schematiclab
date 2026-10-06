// The (camo mod namespace, Minecraft version) pairs whose camo NBT the server
// writes (`write.ts`). Each pair has a camo fixture saved in-game by the mod
// itself (`src/lib/__tests__/fixtures/CAMO_FIXTURES.md`), so the written
// block entities are known to match what the mod saves. Other versions get
// their camo options listed, but not written.

/**
 * Namespace → Minecraft versions camo is written for. A pair needs a camo
 * fixture saved by the mod on that version (listed in `CAMO_FIXTURES.md`)
 * before it is added here.
 */
export const CAMO_WRITE_VERSIONS: Readonly<Record<string, readonly string[]>> =
  {
    framedblocks: ["1.21.1", "26.1.2"],
    create: ["1.21.1"],
    copycats: ["1.21.1"],
  };

/** Whether camo of `namespace` is written for `minecraftVersion`. */
export function isCamoWritable(
  namespace: string,
  minecraftVersion: string,
): boolean {
  return (
    Object.hasOwn(CAMO_WRITE_VERSIONS, namespace) &&
    CAMO_WRITE_VERSIONS[namespace].includes(minecraftVersion)
  );
}

/** Why camo of `namespace` isn't written for `minecraftVersion`, or undefined. */
export function camoWriteReason(
  namespace: string,
  minecraftVersion: string,
): string | undefined {
  if (isCamoWritable(namespace, minecraftVersion)) return undefined;
  const verified = Object.hasOwn(CAMO_WRITE_VERSIONS, namespace)
    ? CAMO_WRITE_VERSIONS[namespace]
    : [];
  return `Writing ${namespace} camo isn't verified for Minecraft ${minecraftVersion} (no saved camo fixture)${
    verified.length > 0 ? `; it is for ${verified.join(", ")}` : ""
  }.`;
}

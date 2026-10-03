// Model JSON as generated-block providers see it: mod models from the file
// loaded for the model's namespace, vanilla ones from the vanilla bundle.
//
// Worker-safe: no DOM access.

import type { GeneratedBlockFiles } from "./types";

function namespaceOf(id: string): string {
  const colon = id.indexOf(":");
  return colon < 0 ? "minecraft" : id.slice(0, colon);
}

/** Raw model JSON by normalized id (`ns:block/x`), or undefined. */
export function generatedModelLookup(
  files: GeneratedBlockFiles,
): (id: string) => unknown {
  return (id) => {
    const namespace = namespaceOf(id);
    if (namespace === "minecraft") return files.vanilla?.model(id);
    const file = files.fileForNamespace(namespace);
    const models = file === null ? undefined : files.assets(file)?.models;
    return models !== undefined && Object.hasOwn(models, id)
      ? models[id]
      : undefined;
  };
}

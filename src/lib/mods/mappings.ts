// Reactive store of namespace → CurseForge project mappings.
//
// A namespace (`create` in `create:andesite_casing`) maps to at most one
// CurseForge project; one project may own several namespaces. Mappings are
// made once and reused across schematics and reloads.
//
// Persistence: the `namespaceMappings` object store (keyed by `namespace`) in
// the existing `schematiclab-mods` IndexedDB database, added by the v1 → v2
// upgrade in `store.ts`. If IndexedDB is unavailable the store keeps working
// in-memory only for the session and logs a single `console.warn`, like
// `registry.ts`.
//
// SCHEM-54 may swap this store's backing, so keep the exported interface
// narrow: get / set / remove / list / useNamespaceMappings.

import * as React from "react";

import * as store from "./store";
import type { NamespaceMapping } from "./types";

export type { NamespaceMapping };

export type NamespaceMappingsSnapshot = ReadonlyMap<string, NamespaceMapping>;

const EMPTY: NamespaceMappingsSnapshot = new Map();

let mappings: NamespaceMappingsSnapshot = EMPTY;
let listed: {
  for: NamespaceMappingsSnapshot;
  value: readonly NamespaceMapping[];
} | null = null;
const listeners = new Set<() => void>();
// Namespaces set or removed this session, so a slow hydrate can't clobber them.
const touched = new Set<string>();

let hydration: Promise<void> | null = null;
let persistenceDisabled = false;

function emit(next: NamespaceMappingsSnapshot): void {
  if (next === mappings) return;
  mappings = next;
  listeners.forEach((listener) => {
    listener();
  });
}

function disablePersistence(error: unknown): void {
  if (persistenceDisabled) return;
  persistenceDisabled = true;
  console.warn(
    "Mod mappings will not persist: IndexedDB is unavailable. Mappings are kept for this session only.",
    error,
  );
}

function autoHydrate(): void {
  if (hydration === null && typeof window !== "undefined") {
    void hydrateNamespaceMappings();
  }
}

/**
 * Load persisted mappings into the store. Idempotent: runs once and resolves
 * the same promise on later calls. Never rejects.
 */
export function hydrateNamespaceMappings(): Promise<void> {
  if (hydration === null) {
    hydration = (async () => {
      let stored: NamespaceMapping[];
      try {
        stored = await store.listNamespaceMappings();
      } catch (error) {
        disablePersistence(error);
        return;
      }
      const restored = stored.filter((m) => !touched.has(m.namespace));
      if (restored.length === 0) return;
      const next = new Map(mappings);
      for (const mapping of restored) next.set(mapping.namespace, mapping);
      emit(next);
    })();
  }
  return hydration;
}

function subscribe(listener: () => void): () => void {
  autoHydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NamespaceMappingsSnapshot {
  autoHydrate();
  return mappings;
}

function getServerSnapshot(): NamespaceMappingsSnapshot {
  return EMPTY;
}

/** All mappings keyed by namespace. Identity changes only when they change. */
export function useNamespaceMappings(): NamespaceMappingsSnapshot {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getNamespaceMapping(
  namespace: string,
): NamespaceMapping | null {
  return getSnapshot().get(namespace) ?? null;
}

/** All mappings sorted by namespace. Stable identity per snapshot. */
export function listNamespaceMappings(): readonly NamespaceMapping[] {
  const snapshot = getSnapshot();
  if (listed?.for === snapshot) return listed.value;
  const value = Object.freeze(
    [...snapshot.values()].sort((a, b) =>
      a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0,
    ),
  );
  listed = { for: snapshot, value };
  return value;
}

/**
 * Map a namespace to a project, replacing any existing mapping for it.
 * Resolves once persisted (or immediately when running in-memory only).
 */
export async function setNamespaceMapping(
  mapping: NamespaceMapping,
): Promise<void> {
  touched.add(mapping.namespace);
  const next = new Map(mappings);
  next.set(mapping.namespace, mapping);
  emit(next);

  if (persistenceDisabled) return;
  try {
    await store.putNamespaceMapping(mapping);
  } catch (error) {
    disablePersistence(error);
  }
}

export async function removeNamespaceMapping(namespace: string): Promise<void> {
  touched.add(namespace);
  if (mappings.has(namespace)) {
    const next = new Map(mappings);
    next.delete(namespace);
    emit(next);
  }

  if (persistenceDisabled) return;
  try {
    await store.removeNamespaceMapping(namespace);
  } catch (error) {
    disablePersistence(error);
  }
}

/**
 * Map each of `namespaces` that has no mapping yet to `mod`. Existing
 * mappings (to this or any other project) are left alone. Waits for
 * hydration so persisted mappings aren't overwritten. Resolves to the
 * namespaces that were newly mapped.
 */
export async function autoMapNamespaces(
  namespaces: readonly string[],
  mod: Pick<NamespaceMapping, "modId" | "modName" | "modSlug" | "logoUrl">,
  mappedAt: number,
): Promise<string[]> {
  await hydrateNamespaceMappings();
  const added = [...new Set(namespaces)].filter((ns) => !mappings.has(ns));
  await Promise.all(
    added.map((namespace) =>
      setNamespaceMapping({
        namespace,
        modId: mod.modId,
        modName: mod.modName,
        modSlug: mod.modSlug,
        logoUrl: mod.logoUrl,
        mappedAt,
      }),
    ),
  );
  return added;
}

// Test-only: reset module state between tests.
export function __resetNamespaceMappingsForTests(): void {
  mappings = EMPTY;
  listed = null;
  listeners.clear();
  touched.clear();
  hydration = null;
  persistenceDisabled = false;
}

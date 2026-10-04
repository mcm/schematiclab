// Hardcoded block-type finders as plain data.
//
// Port of the finder builders: Moonlight `BlockType.SetFinderBuilder`,
// `WoodType.Finder`, `LeavesType.Finder` (Moonlight Lib by MehVahdJukaar,
// Xel'Bayria and the Supplementaries Team, https://github.com/MehVahdJukaar/Moonlight,
// branch 1.21, commit 72afa38), Stone Zone `StoneType.Finder`, `MudType.Finder`
// (https://github.com/Xelbayria/Stone-Zone, branch 1.21, commit d17ed21) and
// Gems Realm `GemType.Finder`, `MetalType.Finder`, `CrystalType.Finder`,
// `DustType.Finder` (by Xelbayria, https://github.com/Xelbayria/Gems-Realm,
// branch 1.21.1, commit 66b66be). All under the Supplementaries Team License.
//
// The builder only records ids (resolved with `idWithOptionalNamespace` as the
// Java setters do); `detect.ts` looks them up. A finder's main block (planks,
// leaves, stone, mud, gem/metal/crystal/dust block) and log are required, its
// children optional, as in each `Finder.get()`.
//
// Worker-safe: no DOM access.

import { idWithOptionalNamespace, parseId } from "./java-compat";
import type { BlockTypeKind } from "./types";

/** A finder's lookup of one block or item. */
export interface FinderRef {
  id: string;
  item?: true;
}

/** One hardcoded finder (`addSimpleFinder(...)` plus its setters). */
export interface FinderSpec {
  kind: BlockTypeKind;
  /** Type id, `ns:path`. */
  id: string;
  /** Main block (planks / leaves / stone / …); undefined = the kind's default lookup. */
  main?: FinderRef;
  /** Wood only: log block; undefined = `WoodType.findLog`. */
  log?: FinderRef;
  /** Wood only: `.bambooLike(…)`; undefined = `defaultIsBambooLike`. */
  bambooLike?: boolean;
  /** `childNames` puts in source order (iterated in Java HashMap order). */
  children: [string, FinderRef][];
  /**
   * Leaves only: `.equivalentWood(id)`, which calls
   * `addLeavesToWoodMapping(finder id, id)` when the finder is built.
   */
  equivalentWood?: string;
  /**
   * Extra gate around the `addSimpleFinder` call in the Java source (e.g.
   * `if (!PlatHelper.isModLoaded("archwood_good"))`). `Finder.get()` itself
   * also requires the finder's namespace to be loaded.
   */
  when?: (isModLoaded: (modId: string) => boolean) => boolean;
}

/** Chainable builder mirroring the Java setters. */
export class FinderBuilder {
  readonly spec: FinderSpec;
  private readonly namespace: string;
  private readonly path: string;

  constructor(kind: BlockTypeKind, id: string) {
    const { namespace, path } = parseId(id);
    this.namespace = namespace;
    this.path = path;
    this.spec = { kind, id: `${namespace}:${path}`, children: [] };
  }

  private ref(name: string, item?: true): FinderRef {
    const id = idWithOptionalNamespace(name, this.namespace);
    return item ? { id, item } : { id };
  }

  /** `planks(…)`, `leaves(…)`, `stone(…)`, `mud(…)`, `gemBlock(…)`, … */
  main(name: string): this {
    this.spec.main = this.ref(name);
    return this;
  }
  /** `planksAffix`, `stoneAffix`, `gemBlockAffix`, …: prefix + path + suffix. */
  mainAffix(prefix: string, suffix: string): this {
    return this.main(prefix + this.path + suffix);
  }
  /** `planksSuffix`, `leavesSuffix`, `stoneSuffix`, …: path + suffix. */
  mainSuffix(suffix: string): this {
    return this.main(this.path + suffix);
  }

  log(name: string): this {
    this.spec.log = this.ref(name);
    return this;
  }
  logSuffix(suffix: string): this {
    return this.log(this.path + suffix);
  }

  bambooLike(value: boolean): this {
    this.spec.bambooLike = value;
    return this;
  }

  equivalentWood(id: string): this {
    this.spec.equivalentWood = id;
    return this;
  }

  when(gate: NonNullable<FinderSpec["when"]>): this {
    this.spec.when = gate;
    return this;
  }

  childBlock(key: string, name: string): this {
    this.spec.children.push([key, this.ref(name)]);
    return this;
  }
  childBlockSuffix(key: string, suffix: string): this {
    return this.childBlock(key, this.path + suffix);
  }
  childBlockAffix(key: string, prefix: string, suffix: string): this {
    return this.childBlock(key, prefix + this.path + suffix);
  }
  childItem(key: string, name: string): this {
    this.spec.children.push([key, this.ref(name, true)]);
    return this;
  }
  childItemSuffix(key: string, suffix: string): this {
    return this.childItem(key, this.path + suffix);
  }
}

/** Collects finders in `addSimpleFinder` order. */
export class FinderList {
  readonly specs: FinderSpec[] = [];

  add(
    kind: BlockTypeKind,
    namespaceOrId: string,
    path?: string,
  ): FinderBuilder {
    const builder = new FinderBuilder(
      kind,
      path === undefined ? namespaceOrId : `${namespaceOrId}:${path}`,
    );
    this.specs.push(builder.spec);
    return builder;
  }
}

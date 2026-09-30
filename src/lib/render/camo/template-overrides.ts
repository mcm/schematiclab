// Swaps a shape pack's template-derived pieces for the templates in a loaded
// FramedBlocks jar, so shapes follow the exact release the user loaded.
//
// `pnpm gen:camo-shapes` tags each piece cut from a `framed_templates/*.json`
// cube with the template id and cube index. The pieces of one template use
// (one source file of one block state) are a run of consecutive tagged
// pieces with that id, starting at element 0. Each run is replaced by one
// piece per cube of the jar's template, keeping the run's slot, offset,
// transform and ops. Like the generator, pieces with ops (a post modifier
// that moves faces off their cull side) never cull.
// Pure: no DOM, no deepslate.

import {
  DIRECTIONS,
  type ShapePack,
  type ShapePiece,
  type ShapeRule,
  type TemplateCube,
} from "./shape-pack";

/** Template id (`framedblocks:<name>`) → cubes. */
export type TemplateSet = Readonly<Record<string, readonly TemplateCube[]>>;

function templatePieces(
  first: ShapePiece,
  id: string,
  cubes: readonly TemplateCube[],
): ShapePiece[] {
  return cubes.map((cube, element) => {
    const faces = DIRECTIONS.filter((dir) => cube.faces[dir] !== undefined);
    return {
      slot: first.slot,
      select: { from: [...cube.box.from], to: [...cube.box.to] },
      offset: first.offset,
      transform: first.transform,
      cull:
        first.ops.length > 0
          ? []
          : faces.filter((dir) => cube.faces[dir] === true),
      faces,
      ops: first.ops,
      template: { id, element },
    };
  });
}

function overrideRule(rule: ShapeRule, templates: TemplateSet): ShapeRule {
  const applies = rule.pieces.some(
    (piece) =>
      piece.template !== undefined &&
      Object.hasOwn(templates, piece.template.id),
  );
  if (!applies) return rule;
  const pieces: ShapePiece[] = [];
  let i = 0;
  while (i < rule.pieces.length) {
    const piece = rule.pieces[i];
    const id = piece.template?.id;
    const cubes =
      id !== undefined && Object.hasOwn(templates, id)
        ? templates[id]
        : undefined;
    if (id === undefined || cubes === undefined) {
      pieces.push(piece);
      i += 1;
      continue;
    }
    // The run ends at the next element 0 (another use of the same template)
    // or at a piece from anything else.
    let end = i + 1;
    while (
      end < rule.pieces.length &&
      rule.pieces[end].template?.id === id &&
      rule.pieces[end].template!.element !== 0
    ) {
      end += 1;
    }
    pieces.push(...templatePieces(piece, id, cubes));
    i = end;
  }
  return { ...rule, pieces };
}

/**
 * `pack` with the pieces of every template in `templates` rebuilt from those
 * templates. Returns `pack` itself when no template applies.
 */
export function applyTemplateOverrides(
  pack: ShapePack,
  templates: TemplateSet,
): ShapePack {
  if (Object.keys(templates).length === 0) return pack;
  let changed = false;
  const blocks: Record<string, ShapeRule[]> = {};
  for (const [id, rules] of Object.entries(pack.blocks)) {
    const next = rules.map((rule) => overrideRule(rule, templates));
    if (next.every((rule, i) => rule === rules[i])) {
      blocks[id] = rules;
    } else {
      blocks[id] = next;
      changed = true;
    }
  }
  return changed ? { ...pack, blocks } : pack;
}

/** Every mod's templates merged, later mods winning on the same id. */
export function mergeTemplates(
  mods: readonly { templates?: TemplateSet }[],
): Record<string, readonly TemplateCube[]> {
  const merged: Record<string, readonly TemplateCube[]> = {};
  for (const mod of mods) {
    for (const [id, cubes] of Object.entries(mod.templates ?? {})) {
      merged[id] = cubes;
    }
  }
  return merged;
}

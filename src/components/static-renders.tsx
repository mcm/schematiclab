"use client";

import * as React from "react";
import { Button, Input, Label } from "@iamthemcmaster/ui";
import { IconDownload } from "@tabler/icons-react";
import { knownVersionIdFor } from "@/lib/advanced/effective-mod-version";
import { sourceAppearance } from "@/lib/advanced/suggest-blocks";
import { useVanillaBlockColors } from "@/lib/advanced/vanilla-block-colors";
import type { ParsedSchematicProjection } from "@/lib/convert";
import { ensureModAppearances } from "@/lib/mods/appearance-backfill";
import { useLoadedMods } from "@/lib/mods/registry";
import {
  contactSheetLayout,
  drawContactSheet,
} from "@/lib/render/contact-sheet";
import { toDisplayProjection } from "@/lib/render/display-translation";
import { staticRenderColors } from "@/lib/render/static-render-colors";
import { buildVoxelModel, defaultPlanLevels } from "@/lib/render/static-views";

// The sheet is drawn at twice its layout size so it stays sharp when zoomed
// and in the downloaded PNG.
const PIXEL_RATIO = 2;

interface StaticRendersProps {
  projection: ParsedSchematicProjection;
  inputFilename: string;
}

function baseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * A contact sheet of the schematic from several angles (four isometric
 * views, elevations, two plan slices and a cutaway), with a PNG download.
 */
export function StaticRenders({
  projection,
  inputFilename,
}: StaticRendersProps) {
  const vanillaColors = useVanillaBlockColors();
  const loadedMods = useLoadedMods();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const displayProjection = React.useMemo(
    () => toDisplayProjection(projection),
    [projection],
  );
  const versionId = knownVersionIdFor(projection.minecraftVersion);

  // Mod files loaded before appearances existed get them computed in the
  // background; the registry update redraws the sheet.
  React.useEffect(() => {
    const namespaces = new Set(
      displayProjection.palette.map((e) =>
        e.blockId.slice(0, e.blockId.indexOf(":")),
      ),
    );
    for (const file of loadedMods) {
      if (file.appearancesComputed === true) continue;
      if (file.namespaces.some((ns) => namespaces.has(ns))) {
        void ensureModAppearances(file.key);
      }
    }
  }, [displayProjection, loadedMods]);

  const model = React.useMemo(() => {
    const colors = staticRenderColors(displayProjection, (blockId) =>
      sourceAppearance(blockId, vanillaColors, loadedMods, versionId),
    );
    return buildVoxelModel(displayProjection, colors.colorFor, colors.colorAt);
  }, [displayProjection, vanillaColors, loadedMods, versionId]);

  const height = model.size[1];
  const defaults = React.useMemo(() => defaultPlanLevels(model), [model]);
  const [levelOverrides, setLevelOverrides] = React.useState<
    [number | null, number | null]
  >([null, null]);
  const clampLevel = (level: number) =>
    Math.max(0, Math.min(Math.max(0, height - 1), level));
  const planLevels: [number, number] = [
    clampLevel(levelOverrides[0] ?? defaults[0]),
    clampLevel(levelOverrides[1] ?? defaults[1]),
  ];

  const name = projection.name.trim() || baseName(inputFilename);
  const layout = React.useMemo(
    () => contactSheetLayout(model, { name, planLevels }),
    // planLevels is a fresh array each render; depend on its values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, name, planLevels[0], planLevels[1]],
  );

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = layout.width * PIXEL_RATIO;
    canvas.height = layout.height * PIXEL_RATIO;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0);
    drawContactSheet(ctx, model, layout);
  }, [model, layout]);

  const handleDownload = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.toBlob((blob) => {
      if (blob === null) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName(inputFilename)}-renders.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [inputFilename]);

  const setLevel = (which: 0 | 1, value: string) => {
    const parsed = Number.parseInt(value, 10);
    setLevelOverrides((prev) => {
      const next: [number | null, number | null] = [...prev];
      next[which] = Number.isNaN(parsed) ? null : clampLevel(parsed);
      return next;
    });
  };

  if (model.voxels.length === 0) {
    return <span>This schematic has no visible blocks to render.</span>;
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        {([0, 1] as const).map((which) => (
          <div
            key={which}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <Label
              htmlFor={`static-renders-plan-${which}`}
              style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}
            >
              {which === 0 ? "Plan & cutaway y" : "Second plan y"}
            </Label>
            <Input
              id={`static-renders-plan-${which}`}
              type="number"
              min={0}
              max={Math.max(0, height - 1)}
              value={planLevels[which]}
              onChange={(e) => setLevel(which, e.currentTarget.value)}
              style={{ width: 72 }}
            />
          </div>
        ))}
        {vanillaColors === null ? (
          <span role="status" style={{ fontSize: "var(--text-xs)" }}>
            Loading block colours…
          </span>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleDownload}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
          }}
        >
          <IconDownload size={14} aria-hidden="true" />
          Download PNG
        </Button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Static renders of ${name}: four isometric views, front, side and top elevations, plan slices at y=${planLevels[0]} and y=${planLevels[1]}, and a cutaway.`}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      </div>
    </div>
  );
}

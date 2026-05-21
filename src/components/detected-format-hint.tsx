"use client";

export type DetectionState =
  | { status: "idle" }
  | { status: "detecting" }
  | { status: "ok"; formatId: string }
  | { status: "failed" };

// Detection ids → human-readable names (no extension suffix). Mirrors the keys
// in `format-selector.tsx::FORMAT_OPTIONS` but also includes `Sponge[v3]`,
// which detection can return but isn't a supported conversion output.
const FORMAT_LABELS: Record<string, string> = {
  Litematic: "Litematic",
  "Sponge[v1]": "Sponge v1",
  "Sponge[v2]": "Sponge v2",
  "Sponge[v3]": "Sponge v3",
  Structure: "Structure",
  "BuildingGadgets[1.12]": "Building Gadgets 1.12",
  "BuildingGadgets[1.14.4-1.19.3]": "Building Gadgets 1.14.4–1.19.3",
  "BuildingGadgets2[1.20+]": "Building Gadgets 2 1.20+",
  StructurizeBlueprint: "Structurize Blueprint",
  JSON: "schemlib JSON",
};

export function detectedFormatLabel(id: string): string {
  return FORMAT_LABELS[id] ?? id;
}

interface DetectedFormatHintProps {
  state: DetectionState;
}

export function DetectedFormatHint({ state }: DetectedFormatHintProps) {
  if (state.status === "idle" || state.status === "failed") {
    return null;
  }

  const isDetecting = state.status === "detecting";
  const text = isDetecting
    ? "Detecting…"
    : `Detected format: ${detectedFormatLabel(state.formatId)}`;

  return (
    <div
      aria-live="polite"
      style={{
        fontSize: "var(--text-sm)",
        color: isDetecting ? "var(--text-tertiary)" : "var(--text-secondary)",
      }}
    >
      {text}
    </div>
  );
}

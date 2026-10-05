"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TabsContent,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@iamthemcmaster/ui";
import { IconArrowLeft, IconDownload, IconLoader2 } from "@tabler/icons-react";
import { FormatSelector } from "@/components/format-selector";
import { InlineError } from "@/components/inline-error";
import { StaticRenders } from "@/components/static-renders";
import { ThreeDPreview } from "@/components/three-d-preview";
import { isCatalogedBlockId, searchBlockCatalog } from "@/lib/block-catalog";
import type { SchematicFormatId } from "@/lib/convert";
import {
  cancel,
  exportShapeInWorker,
  previewShapeInWorker,
} from "@/lib/convert-client";
import {
  setOutputFormat as storeSetOutputFormat,
  setStagedFile as storeSetStagedFile,
  useEditorState,
} from "@/lib/editor-state";
import {
  defaultShapeName,
  parseMaterial,
  vanillaMaterialError,
  type ShapePreviewResult,
  type ShapeSpec,
} from "@/lib/shapes/generate";
import {
  MAX_DIMENSION,
  MAX_THICKNESS,
  SHAPE_KINDS,
  type ShapeAxis,
  type ShapeKind,
} from "@/lib/shapes/shapes";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";

const SHAPE_LABELS: Record<ShapeKind, string> = {
  cuboid: "Cuboid",
  ellipsoid: "Sphere / ellipsoid",
  dome: "Dome",
  cylinder: "Cylinder",
  cone: "Cone",
  pyramid: "Pyramid",
};

const AXIS_LABELS: Record<ShapeAxis, string> = {
  y: "Upright (Y)",
  x: "Lying east–west (X)",
  z: "Lying north–south (Z)",
};

const VERSION_IDS: readonly string[] = Object.keys(KNOWN_VERSIONS);
const DEFAULT_VERSION_ID = VERSION_IDS[VERSION_IDS.length - 1];
const MAX_MATERIAL_SUGGESTIONS = 50;
const PREVIEW_DEBOUNCE_MS = 300;
// Bigger shapes are still generated, but not drawn: the preview meshes
// every block on the main thread. The worker doesn't send their blocks.
const MAX_PREVIEW_BLOCKS = 300_000;
const WORKER_CANCELLED_MESSAGE = "Worker cancelled";
const GENERIC_EXPORT_ERROR =
  "Something went wrong while generating. Please try again.";

const FIELD_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const HINT_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs)",
  color: "var(--text-tertiary)",
};

function triggerDownload(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseDimension(label: string, text: string): number | string {
  const value = Number(text);
  if (
    text.trim() === "" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_DIMENSION
  ) {
    return `${label} must be a whole number from 1 to ${MAX_DIMENSION}.`;
  }
  return value;
}

interface FormState {
  shape: ShapeKind;
  axis: ShapeAxis;
  width: string;
  height: string;
  depth: string;
  hollow: boolean;
  thickness: string;
  material: string;
  versionId: string;
  name: string;
}

const INITIAL_FORM: FormState = {
  shape: "ellipsoid",
  axis: "y",
  width: "15",
  height: "15",
  depth: "15",
  hollow: false,
  thickness: "1",
  material: "minecraft:stone_bricks",
  versionId: DEFAULT_VERSION_ID,
  name: "",
};

// The spec the form describes, or the first thing wrong with it.
function specFromForm(
  form: FormState,
): { spec: ShapeSpec; error: null } | { spec: null; error: string } {
  const dims: number[] = [];
  for (const [label, text] of [
    ["Width", form.width],
    ["Height", form.height],
    ["Depth", form.depth],
  ] as const) {
    const value = parseDimension(label, text);
    if (typeof value === "string") return { spec: null, error: value };
    dims.push(value);
  }
  let thickness = 1;
  if (form.hollow) {
    const value = Number(form.thickness);
    if (
      form.thickness.trim() === "" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_THICKNESS
    ) {
      return {
        spec: null,
        error: `Wall thickness must be a whole number from 1 to ${MAX_THICKNESS}.`,
      };
    }
    thickness = value;
  }
  const material = parseMaterial(form.material);
  if (!material.ok) return { spec: null, error: material.error };
  const vanillaError = vanillaMaterialError(material.material, form.versionId);
  if (vanillaError !== null) return { spec: null, error: vanillaError };
  return {
    spec: {
      shape: form.shape,
      ...(form.shape === "cylinder" ? { axis: form.axis } : {}),
      width: dims[0],
      height: dims[1],
      depth: dims[2],
      hollow: form.hollow,
      thickness,
      material: form.material,
      versionId: form.versionId,
      name: form.name.trim() || undefined,
    },
    error: null,
  };
}

// The worker's answer for one spec (`key`) and preview request (`nonce`).
interface PreviewResult {
  key: string;
  nonce: number;
  result: ShapePreviewResult;
}

type ShapePreviewData = Extract<ShapePreviewResult, { ok: true }>;

type PreviewState =
  | { status: "idle" }
  // `previous` is the last shape drawn, kept on screen meanwhile.
  | { status: "generating"; previous: ShapePreviewData | null }
  | { status: "ready"; shape: ShapePreviewData }
  | { status: "error"; error: string };

function previewState(
  specKey: string | null,
  nonce: number,
  latest: PreviewResult | null,
): PreviewState {
  if (specKey === null) return { status: "idle" };
  if (latest === null || latest.key !== specKey || latest.nonce !== nonce) {
    return {
      status: "generating",
      previous: latest?.result.ok ? latest.result : null,
    };
  }
  return latest.result.ok
    ? { status: "ready", shape: latest.result }
    : { status: "error", error: latest.result.error };
}

export default function ShapeGeneratorPage() {
  const router = useRouter();
  const editorState = useEditorState();
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [outputFormat, setOutputFormat] =
    React.useState<SchematicFormatId | null>(() => editorState.outputFormat);
  const [busy, setBusy] = React.useState<"download" | "advanced" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  const update = React.useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setError(null);
    },
    [],
  );

  const { spec, error: formError } = React.useMemo(
    () => specFromForm(form),
    [form],
  );
  const specKey = spec === null ? null : JSON.stringify(spec);

  const catalogScope = React.useMemo(
    () => ({
      version: KNOWN_VERSIONS[form.versionId],
      versionId: form.versionId,
    }),
    [form.versionId],
  );
  const materialSuggestions = React.useMemo(
    () =>
      searchBlockCatalog(form.material, MAX_MATERIAL_SUGGESTIONS, catalogScope),
    [form.material, catalogScope],
  );
  const materialNote = React.useMemo(() => {
    const parsed = parseMaterial(form.material);
    if (!parsed.ok || parsed.material.blockId.startsWith("minecraft:")) {
      return null;
    }
    if (isCatalogedBlockId(parsed.material.blockId, catalogScope)) return null;
    return `${parsed.material.blockId} isn't in a mod file loaded for Minecraft ${form.versionId}. It will be written as typed.`;
  }, [form.material, form.versionId, catalogScope]);

  // Regenerate the preview shortly after the form settles. Only the latest
  // request's answer is kept. Cancelling a download also drops an in-flight
  // preview request; bumping `previewNonce` asks again.
  const requestRef = React.useRef(0);
  const [previewNonce, setPreviewNonce] = React.useState(0);
  const [latestPreview, setLatestPreview] =
    React.useState<PreviewResult | null>(null);
  const preview = React.useMemo(
    () => previewState(specKey, previewNonce, latestPreview),
    [specKey, previewNonce, latestPreview],
  );
  const previewGenerating = preview.status === "generating";
  React.useEffect(() => {
    if (spec === null || specKey === null) return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      previewShapeInWorker(spec, MAX_PREVIEW_BLOCKS).then(
        (result) => {
          if (request !== requestRef.current) return;
          setLatestPreview({ key: specKey, nonce: previewNonce, result });
        },
        (err: unknown) => {
          if (request !== requestRef.current) return;
          const message = err instanceof Error ? err.message : String(err);
          if (message === WORKER_CANCELLED_MESSAGE) return;
          setLatestPreview({
            key: specKey,
            nonce: previewNonce,
            result: { ok: false, error: message },
          });
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `spec` is rebuilt with `form`; `specKey` captures its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, previewNonce]);

  const handleOutputFormatChange = React.useCallback(
    (next: SchematicFormatId) => {
      setOutputFormat(next);
      storeSetOutputFormat(next);
      setError(null);
    },
    [],
  );

  // Builds and writes the shape in the chosen format, all in the worker.
  const writeShape = React.useCallback(async () => {
    if (spec === null || outputFormat === null) return null;
    const name = spec.name ?? defaultShapeName(spec);
    // Export swaps the input filename's extension for the format's; give it
    // one so a dot in the name survives.
    const result = await exportShapeInWorker(
      spec,
      outputFormat,
      `${name}.shape`,
    );
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    return result;
  }, [spec, outputFormat]);

  const run = React.useCallback(
    async (kind: "download" | "advanced") => {
      if (busy !== null || outputFormat === null) return;
      cancelledRef.current = false;
      setError(null);
      setBusy(kind);
      try {
        const result = await writeShape();
        if (cancelledRef.current || result === null) return;
        if (kind === "download") {
          triggerDownload(result.bytes, result.filename, result.mimeType);
        } else {
          storeSetStagedFile({
            bytes: result.bytes,
            filename: result.filename,
            inputFormat: outputFormat,
          });
          router.push("/advanced");
        }
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message === WORKER_CANCELLED_MESSAGE) return;
        setError(GENERIC_EXPORT_ERROR);
      } finally {
        setBusy(null);
      }
    },
    [busy, outputFormat, writeShape, router],
  );

  const handleCancel = React.useCallback(() => {
    cancelledRef.current = true;
    cancel();
    if (previewGenerating) setPreviewNonce((n) => n + 1);
  }, [previewGenerating]);

  const canWrite = spec !== null && outputFormat !== null && busy === null;
  const visibleError = formError ?? error;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-page)",
        }}
      >
        <Button asChild variant="ghost" size="sm">
          <Link
            href="/"
            aria-label="Back to Quick Convert"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <IconArrowLeft size={14} aria-hidden="true" />
            <span className="schematiclab-hide-narrow">
              Back to Quick Convert
            </span>
          </Link>
        </Button>
        <div
          style={{
            width: 1,
            height: 20,
            background: "var(--border-subtle)",
          }}
          aria-hidden="true"
        />
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          Shape Generator
        </h1>
      </header>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "stretch",
          gap: "var(--space-4)",
          padding: "var(--space-4)",
        }}
      >
        <Card style={{ flex: "1 1 320px", maxWidth: 440 }}>
          <CardContent
            style={{
              padding: "clamp(var(--space-4), 6vw, var(--space-8))",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <div style={FIELD_STYLE}>
              <Label htmlFor="shape-kind-trigger">Shape</Label>
              <Select
                value={form.shape}
                onValueChange={(next) => update("shape", next as ShapeKind)}
              >
                <SelectTrigger
                  id="shape-kind-trigger"
                  style={{ width: "100%" }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHAPE_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {SHAPE_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.shape === "cylinder" ? (
              <div style={FIELD_STYLE}>
                <Label htmlFor="shape-axis-trigger">Orientation</Label>
                <Select
                  value={form.axis}
                  onValueChange={(next) => update("axis", next as ShapeAxis)}
                >
                  <SelectTrigger
                    id="shape-axis-trigger"
                    style={{ width: "100%" }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AXIS_LABELS) as ShapeAxis[]).map((axis) => (
                      <SelectItem key={axis} value={axis}>
                        {AXIS_LABELS[axis]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "var(--space-2)",
              }}
            >
              {(
                [
                  ["width", "Width (X)"],
                  ["height", "Height (Y)"],
                  ["depth", "Depth (Z)"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} style={FIELD_STYLE}>
                  <Label htmlFor={`shape-${key}`}>{label}</Label>
                  <Input
                    id={`shape-${key}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_DIMENSION}
                    step={1}
                    value={form[key]}
                    onChange={(e) => update(key, e.currentTarget.value)}
                  />
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <Checkbox
                  id="shape-hollow"
                  checked={form.hollow}
                  onCheckedChange={(checked) =>
                    update("hollow", checked === true)
                  }
                />
                <Label htmlFor="shape-hollow">Hollow</Label>
              </div>
              {form.hollow ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                  }}
                >
                  <Label htmlFor="shape-thickness">Wall thickness</Label>
                  <Input
                    id="shape-thickness"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_THICKNESS}
                    step={1}
                    value={form.thickness}
                    onChange={(e) => update("thickness", e.currentTarget.value)}
                    style={{ width: 80 }}
                  />
                </div>
              ) : null}
            </div>

            <div style={FIELD_STYLE}>
              <Label htmlFor="shape-version-trigger">Minecraft version</Label>
              <Select
                value={form.versionId}
                onValueChange={(next) => update("versionId", next)}
              >
                <SelectTrigger
                  id="shape-version-trigger"
                  style={{ width: "100%" }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERSION_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div style={FIELD_STYLE}>
              <Label htmlFor="shape-material">Material</Label>
              <Input
                id="shape-material"
                type="text"
                value={form.material}
                placeholder="e.g. minecraft:oak_log[axis=y]"
                autoComplete="off"
                spellCheck={false}
                list="shape-material-suggestions"
                onChange={(e) => update("material", e.currentTarget.value)}
              />
              <datalist id="shape-material-suggestions">
                {materialSuggestions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <p style={HINT_STYLE}>
                {materialNote ??
                  (form.versionId === "1.12.2"
                    ? "Use 1.13+ block ids; they are written as their 1.12 block states."
                    : "Add block properties in brackets, e.g. [axis=x].")}
              </p>
            </div>

            <div style={FIELD_STYLE}>
              <Label htmlFor="shape-name">Name</Label>
              <Input
                id="shape-name"
                type="text"
                value={form.name}
                placeholder={spec !== null ? defaultShapeName(spec) : ""}
                autoComplete="off"
                onChange={(e) => update("name", e.currentTarget.value)}
              />
            </div>

            <FormatSelector
              value={outputFormat}
              onChange={handleOutputFormatChange}
            />

            <InlineError message={visibleError} />

            {busy !== null ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--space-3)",
                }}
              >
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-3) var(--space-4)",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--font-weight-medium)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <IconLoader2
                    size={18}
                    style={{
                      animation: "schematiclab-spin 0.9s linear infinite",
                    }}
                    aria-hidden
                  />
                  <span>Generating…</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="md"
                  disabled={!canWrite}
                  onClick={() => void run("download")}
                  style={{
                    width: "100%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--space-2)",
                  }}
                >
                  <IconDownload size={16} aria-hidden="true" />
                  Generate &amp; Download
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={!canWrite}
                  onClick={() => void run("advanced")}
                  style={{ width: "100%" }}
                >
                  Open in Advanced Editor
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <ShapePreview preview={preview} />
      </div>
    </main>
  );
}

type PreviewTabId = "3d" | "static";

function ShapePreview({ preview }: { preview: PreviewState }) {
  const [activeTab, setActiveTab] = React.useState<PreviewTabId>("3d");
  const shown =
    preview.status === "ready"
      ? preview.shape
      : preview.status === "generating"
        ? preview.previous
        : null;
  const projection = shown?.projection ?? null;

  let message: React.ReactNode = null;
  if (preview.status === "idle") {
    message = "Fix the settings to see a preview.";
  } else if (preview.status === "error") {
    message = preview.error;
  } else if (shown === null) {
    message = "Generating preview…";
  } else if (projection === null) {
    message = `${shown.totalBlocks.toLocaleString()} blocks is too many to preview. You can still download it.`;
  }

  const [w, h, d] = shown !== null ? shown.size : [0, 0, 0];

  return (
    <Card
      style={{
        flex: "999 1 480px",
        display: "flex",
        flexDirection: "column",
        minHeight: 520,
      }}
    >
      <CardContent
        style={{
          padding: "var(--space-4)",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <Tabs
          variant="underline"
          value={activeTab}
          onValueChange={(next) => setActiveTab(next as PreviewTabId)}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TabsList className="schematiclab-tab-list">
            <TabsTrigger value="3d">3D Preview</TabsTrigger>
            <TabsTrigger value="static">Static Renders</TabsTrigger>
          </TabsList>
          {projection === null ? (
            <div
              role="status"
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                border: "1px dashed var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                marginTop: "var(--space-2)",
                padding: "var(--space-4)",
                color: "var(--text-tertiary)",
                fontSize: "var(--text-sm)",
              }}
            >
              {message}
            </div>
          ) : (
            <>
              <TabsContent
                value="3d"
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: activeTab === "3d" ? "flex" : "none",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minHeight: 360,
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    background: "var(--bg-page)",
                  }}
                >
                  <ThreeDPreview projection={projection} />
                </div>
              </TabsContent>
              <TabsContent
                value="static"
                style={{
                  flex: 1,
                  minHeight: 0,
                  flexDirection: "column",
                  display: activeTab === "static" ? "flex" : "none",
                }}
              >
                <StaticRenders
                  projection={projection}
                  inputFilename={projection.name}
                />
              </TabsContent>
            </>
          )}
        </Tabs>
        {shown !== null ? (
          <p
            role="status"
            style={{ ...HINT_STYLE, fontSize: "var(--text-sm)" }}
          >
            {shown.totalBlocks.toLocaleString()} blocks · {w} × {h} × {d}
            {preview.status === "generating" ? " · updating…" : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

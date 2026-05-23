"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@iamthemcmaster/ui";
import schematiclabLogo from "../../public/schematiclab.png";
import { FileDropzone } from "@/components/file-dropzone";
import { UrlImport } from "@/components/url-import";
import { FormatSelector } from "@/components/format-selector";
import { VersionSelector } from "@/components/version-selector";
import {
  DetectedFormatHint,
  type DetectionState,
} from "@/components/detected-format-hint";
import { SubmitButton } from "@/components/submit-button";
import { AdvancedEditorButton } from "@/components/advanced-editor-button";
import { InlineError } from "@/components/inline-error";
import type { SchematicFormatId } from "@/lib/convert";
import { cancel, convertInWorker, detectInWorker } from "@/lib/convert-client";
import {
  setOutputFormat as storeSetOutputFormat,
  setStagedFile as storeSetStagedFile,
  setTargetVersion as storeSetTargetVersion,
  useEditorState,
} from "@/lib/editor-state";

const UNRECOGNIZED_INPUT_MESSAGE =
  "We couldn't recognize this file as a supported schematic format.";
const GENERIC_CONVERSION_ERROR =
  "Something went wrong during conversion. Please try again.";
const WORKER_CANCELLED_MESSAGE = "Worker cancelled";

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

export default function HomePage() {
  const router = useRouter();
  const editorState = useEditorState();

  // `pendingFile` is the locally-selected File while detection is in flight.
  // After detection succeeds it is written through to the shared store as
  // `stagedFile` (bytes + filename + inputFormat). On remount we may have a
  // stagedFile already (user navigated back from `/advanced`); we synthesize
  // a File for display so `FileDropzone` can show the filename/size without
  // re-running detection.
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [detection, setDetection] = React.useState<DetectionState>(() =>
    editorState.stagedFile
      ? { status: "ok", formatId: editorState.stagedFile.inputFormat }
      : { status: "idle" },
  );
  const [isConverting, setIsConverting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  const displayFile = React.useMemo<File | null>(() => {
    if (pendingFile) return pendingFile;
    const staged = editorState.stagedFile;
    if (!staged) return null;
    return new File([staged.bytes as BlobPart], staged.filename);
  }, [pendingFile, editorState.stagedFile]);

  const handleFileChange = React.useCallback((next: File | null) => {
    setError(null);
    if (!next) {
      setPendingFile(null);
      setDetection({ status: "idle" });
      storeSetStagedFile(null);
      return;
    }
    setPendingFile(next);
    setDetection({ status: "detecting" });
  }, []);

  const handleOutputFormatChange = React.useCallback(
    (next: SchematicFormatId | null) => {
      storeSetOutputFormat(next);
      setError(null);
    },
    [],
  );

  const handleTargetVersionChange = React.useCallback((next: string | null) => {
    storeSetTargetVersion(next);
    setError(null);
  }, []);

  React.useEffect(() => {
    if (!pendingFile) return;
    let cancelled = false;
    (async () => {
      try {
        const buffer = await pendingFile.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        // Copy before transferring — `bytes` is about to be stored as the
        // canonical staged buffer that both convert and /advanced parse use.
        // Letting detectInWorker transfer this view would detach it.
        const detected = await detectInWorker(new Uint8Array(bytes));
        if (cancelled) return;
        // `detectInWorker` returns `string` but the runtime value is one of the
        // canonical `SchematicFormatId`s (mirrors `detectSchematicType` output).
        const formatId = detected as SchematicFormatId;
        storeSetStagedFile({
          bytes,
          filename: pendingFile.name,
          inputFormat: formatId,
        });
        setDetection({ status: "ok", formatId });
      } catch {
        if (cancelled) return;
        storeSetStagedFile(null);
        setDetection({ status: "failed" });
        setError(UNRECOGNIZED_INPUT_MESSAGE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingFile]);

  const handleSubmit = React.useCallback(async () => {
    const staged = editorState.stagedFile;
    const outputFormat = editorState.outputFormat;
    if (!staged || !outputFormat || isConverting) return;
    cancelledRef.current = false;
    setError(null);
    setIsConverting(true);
    try {
      // Copy before transferring — keep the store's bytes intact so a
      // subsequent "Open in Advanced Editor" still has parseable input.
      const result = await convertInWorker(
        new Uint8Array(staged.bytes),
        outputFormat,
        editorState.targetVersion ?? undefined,
        staged.filename,
      );
      if (cancelledRef.current) return;
      if (result.ok) {
        triggerDownload(result.bytes, result.filename, result.mimeType);
      } else {
        setError(result.error);
      }
    } catch (err) {
      if (cancelledRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      if (message === WORKER_CANCELLED_MESSAGE) return;
      setError(GENERIC_CONVERSION_ERROR);
    } finally {
      setIsConverting(false);
      cancelledRef.current = false;
    }
  }, [
    editorState.stagedFile,
    editorState.outputFormat,
    editorState.targetVersion,
    isConverting,
  ]);

  const handleCancel = React.useCallback(() => {
    cancelledRef.current = true;
    cancel();
  }, []);

  const handleOpenAdvanced = React.useCallback(() => {
    router.push("/advanced");
  }, [router]);

  const canOpenAdvanced = !!editorState.stagedFile && !isConverting;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "var(--space-6) var(--space-4)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-6)",
        }}
      >
        <Image
          src={schematiclabLogo}
          alt="Schematiclab"
          priority
          sizes="(max-width: 480px) 80vw, 400px"
          style={{
            width: "min(100%, 400px)",
            height: "auto",
          }}
        />

        <Card style={{ width: "100%" }}>
          <CardContent
            style={{
              padding: "var(--space-6)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <FileDropzone file={displayFile} onFileChange={handleFileChange} />
            <UrlImport
              onFileImported={handleFileChange}
              onError={setError}
              disabled={isConverting}
            />
            <DetectedFormatHint state={detection} />
            <FormatSelector
              value={editorState.outputFormat}
              onChange={handleOutputFormatChange}
            />
            <VersionSelector
              value={editorState.targetVersion}
              onChange={handleTargetVersionChange}
            />
            <InlineError message={error} />
            <SubmitButton
              disabled={!editorState.stagedFile || !editorState.outputFormat}
              isConverting={isConverting}
              onClick={handleSubmit}
              onCancel={handleCancel}
            />
            <AdvancedEditorButton
              disabled={!canOpenAdvanced}
              onClick={handleOpenAdvanced}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

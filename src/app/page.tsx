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
  const [file, setFile] = React.useState<File | null>(null);
  const [detection, setDetection] = React.useState<DetectionState>({
    status: "idle",
  });
  const [outputFormat, setOutputFormat] =
    React.useState<SchematicFormatId | null>(null);
  const [targetVersion, setTargetVersion] = React.useState<string | null>(null);
  const [isConverting, setIsConverting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  const handleFileChange = React.useCallback((next: File | null) => {
    setFile(next);
    setError(null);
    setDetection(next ? { status: "detecting" } : { status: "idle" });
  }, []);

  const handleOutputFormatChange = React.useCallback(
    (next: SchematicFormatId | null) => {
      setOutputFormat(next);
      setError(null);
    },
    [],
  );

  const handleTargetVersionChange = React.useCallback((next: string | null) => {
    setTargetVersion(next);
    setError(null);
  }, []);

  React.useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const detected = await detectInWorker(new Uint8Array(buffer));
        if (!cancelled) setDetection({ status: "ok", formatId: detected });
      } catch {
        if (!cancelled) {
          setDetection({ status: "failed" });
          setError(UNRECOGNIZED_INPUT_MESSAGE);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const handleSubmit = React.useCallback(async () => {
    if (!file || !outputFormat || isConverting) return;
    cancelledRef.current = false;
    setError(null);
    setIsConverting(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await convertInWorker(
        new Uint8Array(buffer),
        outputFormat,
        targetVersion ?? undefined,
        file.name,
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
  }, [file, outputFormat, targetVersion, isConverting]);

  const handleCancel = React.useCallback(() => {
    cancelledRef.current = true;
    cancel();
  }, []);

  const handleOpenAdvanced = React.useCallback(() => {
    router.push("/advanced");
  }, [router]);

  const canOpenAdvanced =
    !!file && detection.status === "ok" && !isConverting;

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
            <FileDropzone file={file} onFileChange={handleFileChange} />
            <UrlImport
              onFileImported={handleFileChange}
              onError={setError}
              disabled={isConverting}
            />
            <DetectedFormatHint state={detection} />
            <FormatSelector
              value={outputFormat}
              onChange={handleOutputFormatChange}
            />
            <VersionSelector
              value={targetVersion}
              onChange={handleTargetVersionChange}
            />
            <InlineError message={error} />
            <SubmitButton
              disabled={!file || !outputFormat}
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

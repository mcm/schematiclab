"use client";

import * as React from "react";
import Image from "next/image";
import { Card, CardContent } from "@iamthemcmaster/ui";
import schematiclabLogo from "../../public/schematiclab.png";
import { FileDropzone } from "@/components/file-dropzone";
import { FormatSelector } from "@/components/format-selector";
import { VersionSelector } from "@/components/version-selector";
import {
  DetectedFormatHint,
  type DetectionState,
} from "@/components/detected-format-hint";
import { SubmitButton } from "@/components/submit-button";
import { SUPPORTED_FORMATS, type SchematicFormatId } from "@/lib/convert";
import { cancel, convertInWorker, detectInWorker } from "@/lib/convert-client";

function asSchematicFormatId(value: string): SchematicFormatId | null {
  return (SUPPORTED_FORMATS as readonly string[]).includes(value)
    ? (value as SchematicFormatId)
    : null;
}

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
  const [file, setFile] = React.useState<File | null>(null);
  const [detection, setDetection] = React.useState<DetectionState>({
    status: "idle",
  });
  const [outputFormat, setOutputFormat] =
    React.useState<SchematicFormatId | null>(null);
  const [targetVersion, setTargetVersion] = React.useState<string | null>(null);
  const [isConverting, setIsConverting] = React.useState(false);
  const cancelledRef = React.useRef(false);

  React.useEffect(() => {
    if (!file) {
      setDetection({ status: "idle" });
      return;
    }
    setDetection({ status: "detecting" });
    let cancelled = false;
    (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const detected = await detectInWorker(new Uint8Array(buffer));
        if (!cancelled) setDetection({ status: "ok", formatId: detected });
      } catch {
        if (!cancelled) setDetection({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const detectedFormat: SchematicFormatId | null =
    detection.status === "ok" ? asSchematicFormatId(detection.formatId) : null;

  React.useEffect(() => {
    if (detectedFormat !== null && outputFormat === detectedFormat) {
      setOutputFormat(null);
    }
  }, [detectedFormat, outputFormat]);

  const handleSubmit = React.useCallback(async () => {
    if (!file || !outputFormat || isConverting) return;
    cancelledRef.current = false;
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
        console.error("Conversion failed:", result.error);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        console.error("Conversion failed:", err);
      }
    } finally {
      setIsConverting(false);
      cancelledRef.current = false;
    }
  }, [file, outputFormat, targetVersion, isConverting]);

  const handleCancel = React.useCallback(() => {
    cancelledRef.current = true;
    cancel();
  }, []);

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
            <FileDropzone file={file} onFileChange={setFile} />
            <DetectedFormatHint state={detection} />
            <FormatSelector
              value={outputFormat}
              onChange={setOutputFormat}
              excludedFormat={detectedFormat}
            />
            <VersionSelector
              value={targetVersion}
              onChange={setTargetVersion}
            />
            <SubmitButton
              disabled={!file || !outputFormat}
              isConverting={isConverting}
              onClick={handleSubmit}
              onCancel={handleCancel}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

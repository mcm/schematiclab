"use client";

import * as React from "react";
import Image from "next/image";
import { Card, CardContent } from "@iamthemcmaster/ui";
import schematiclabLogo from "../../public/schematiclab.png";
import { FileDropzone } from "@/components/file-dropzone";
import { FormatSelector } from "@/components/format-selector";
import {
  DetectedFormatHint,
  type DetectionState,
} from "@/components/detected-format-hint";
import { SUPPORTED_FORMATS, type SchematicFormatId } from "@/lib/convert";
import { detectInWorker } from "@/lib/convert-client";

function asSchematicFormatId(value: string): SchematicFormatId | null {
  return (SUPPORTED_FORMATS as readonly string[]).includes(value)
    ? (value as SchematicFormatId)
    : null;
}

export default function HomePage() {
  const [file, setFile] = React.useState<File | null>(null);
  const [detection, setDetection] = React.useState<DetectionState>({
    status: "idle",
  });
  const [outputFormat, setOutputFormat] =
    React.useState<SchematicFormatId | null>(null);

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
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

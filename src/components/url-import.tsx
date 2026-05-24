"use client";

import * as React from "react";
import { Button, Input } from "@iamthemcmaster/ui";
import { IconDownload } from "@tabler/icons-react";

interface UrlImportProps {
  onFileImported: (file: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const GENERIC_IMPORT_ERROR = "Could not import from that URL.";

export function UrlImport({
  onFileImported,
  onError,
  disabled,
}: UrlImportProps) {
  const [url, setUrl] = React.useState("");
  const [isImporting, setIsImporting] = React.useState(false);

  const handleImport = React.useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed || isImporting) return;
    setIsImporting(true);
    try {
      const res = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        onError(body?.error ?? GENERIC_IMPORT_ERROR);
        return;
      }
      const encodedFilename =
        res.headers.get("X-Source-Filename") ?? "imported";
      const filename = decodeURIComponent(encodedFilename);
      const buffer = await res.arrayBuffer();
      const file = new File([buffer], filename);
      onFileImported(file);
      setUrl("");
    } catch {
      onError(GENERIC_IMPORT_ERROR);
    } finally {
      setIsImporting(false);
    }
  }, [url, isImporting, onFileImported, onError]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleImport();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <label
        htmlFor="import-url-input"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
        }}
      >
        Or import from URL
      </label>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Input
          id="import-url-input"
          type="url"
          inputMode="url"
          placeholder="https://pastebin.com/… or https://gist.github.com/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isImporting}
          style={{ flex: 1 }}
        />
        <Button
          variant="outline"
          onClick={handleImport}
          disabled={disabled || isImporting || url.trim() === ""}
          aria-label="Import from URL"
        >
          <IconDownload size={16} />
          {isImporting ? "Importing…" : "Import"}
        </Button>
      </div>
    </div>
  );
}

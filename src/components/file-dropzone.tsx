"use client";

import * as React from "react";
import { Button } from "@iamthemcmaster/ui";
import { IconUpload, IconFile, IconX } from "@tabler/icons-react";

const ACCEPTED_EXTENSIONS = [
  ".litematic",
  ".nbt",
  ".schem",
  ".schematic",
  ".blueprint",
  ".txt",
  ".json",
] as const;

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

interface FileDropzoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDropzone({ file, onFileChange }: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const openPicker = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    if (next) onFileChange(next);
    // Reset the input so re-selecting the same file still fires onChange.
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (dropped) onFileChange(dropped);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    // Ignore leaves that bubble from children — only clear when leaving the dropzone itself.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };

  const baseStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-3)",
    padding: "var(--space-7) var(--space-4)",
    borderRadius: "var(--radius-lg)",
    border: `2px dashed ${isDragging ? "var(--border-accent)" : "var(--border-default)"}`,
    background: isDragging ? "var(--bg-raised)" : "var(--bg-surface)",
    textAlign: "center",
    transition: "border-color 120ms ease, background-color 120ms ease",
  };

  if (file) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-default)",
          background: "var(--bg-surface)",
        }}
        data-testid="dropzone-staged"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "var(--radius-md)",
            background: "var(--bg-raised)",
            color: "var(--text-secondary)",
            flexShrink: 0,
          }}
        >
          <IconFile size={18} />
        </div>
        <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <div
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={file.name}
          >
            {file.name}
          </div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
              marginTop: 2,
            }}
          >
            {formatBytes(file.size)}
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
          <Button variant="outline" size="sm" onClick={openPicker}>
            Replace
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove file"
            onClick={() => onFileChange(null)}
          >
            <IconX size={16} />
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          style={{ display: "none" }}
          onChange={handleInputChange}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{ ...baseStyle, cursor: "pointer" }}
      data-testid="dropzone-empty"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: "var(--radius-full)",
          background: "var(--bg-raised)",
          color: "var(--text-secondary)",
        }}
      >
        <IconUpload size={22} />
      </div>
      <div
        style={{
          fontSize: "var(--text-md)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-primary)",
        }}
      >
        Upload a schematic to get started
      </div>
      <div
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-tertiary)",
        }}
      >
        Drag and drop, or click to browse
      </div>
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {ACCEPTED_EXTENSIONS.join("  ")}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        style={{ display: "none" }}
        onChange={handleInputChange}
      />
    </div>
  );
}

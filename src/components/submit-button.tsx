"use client";

import { Button } from "@iamthemcmaster/ui";
import { IconLoader2 } from "@tabler/icons-react";

interface SubmitButtonProps {
  disabled: boolean;
  isConverting: boolean;
  onClick: () => void;
  onCancel: () => void;
}

export function SubmitButton({
  disabled,
  isConverting,
  onClick,
  onCancel,
}: SubmitButtonProps) {
  if (isConverting) {
    return (
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
          <span>Converting…</span>
        </div>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="primary"
      size="md"
      disabled={disabled}
      onClick={onClick}
      style={{ width: "100%" }}
    >
      Submit
    </Button>
  );
}

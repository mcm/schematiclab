"use client";

import { Button } from "@iamthemcmaster/ui";
import { IconLoader2 } from "@tabler/icons-react";

interface SubmitButtonProps {
  disabled: boolean;
  isConverting: boolean;
  onClick: () => void;
}

export function SubmitButton({
  disabled,
  isConverting,
  onClick,
}: SubmitButtonProps) {
  if (isConverting) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
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

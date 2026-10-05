"use client";

import { IconAlertCircle } from "@tabler/icons-react";

interface InlineErrorProps {
  message: string | null;
}

export function InlineError({ message }: InlineErrorProps) {
  if (message === null) return null;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-2)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--danger-border)",
        background: "var(--danger-tint)",
        color: "var(--danger-fg)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.4,
      }}
    >
      <IconAlertCircle
        size={18}
        aria-hidden
        style={{ flexShrink: 0, marginTop: 1 }}
      />
      <span>{message}</span>
    </div>
  );
}

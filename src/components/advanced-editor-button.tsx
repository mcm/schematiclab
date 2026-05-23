"use client";

import { Button } from "@iamthemcmaster/ui";

interface AdvancedEditorButtonProps {
  disabled: boolean;
  onClick: () => void;
}

export function AdvancedEditorButton({
  disabled,
  onClick,
}: AdvancedEditorButtonProps) {
  return (
    <Button
      variant="secondary"
      size="md"
      disabled={disabled}
      onClick={onClick}
      style={{ width: "100%" }}
    >
      Open in Advanced Editor
    </Button>
  );
}

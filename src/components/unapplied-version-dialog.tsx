"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iamthemcmaster/ui";

interface UnappliedVersionDialogProps {
  open: boolean;
  /** Selected but unapplied target version id, e.g. `"1.16.5"`. */
  targetVersion: string;
  /** The schematic's current version, e.g. `"1.21.0"`. */
  currentVersion: string;
  onStay: () => void;
  onContinue: () => void;
}

// Shown when leaving Version Mapping for Export with a target version picked
// but not applied: Export writes the schematic in its current version.
export function UnappliedVersionDialog({
  open,
  targetVersion,
  currentVersion,
  onStay,
  onContinue,
}: UnappliedVersionDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
    >
      <DialogContent style={{ maxWidth: 480, width: "calc(100vw - 2rem)" }}>
        <DialogHeader>
          <DialogTitle>Version change not applied</DialogTitle>
          <DialogDescription>
            You picked Minecraft {targetVersion} but haven&apos;t applied the
            translation. Export will write the schematic as Minecraft{" "}
            {currentVersion}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onContinue}>
            Export as {currentVersion}
          </Button>
          <Button type="button" variant="primary" onClick={onStay}>
            Back to Version Mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

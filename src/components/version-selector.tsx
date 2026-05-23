"use client";

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iamthemcmaster/ui";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";

const VERSION_IDS: readonly string[] = Object.keys(KNOWN_VERSIONS);
const TRIGGER_ID = "target-version-trigger";

interface VersionSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

export function VersionSelector({ value, onChange }: VersionSelectorProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <Label htmlFor={TRIGGER_ID}>Target Minecraft version</Label>
      <Select
        value={value ?? undefined}
        onValueChange={(next) => onChange(next)}
      >
        <SelectTrigger id={TRIGGER_ID} style={{ width: "100%" }}>
          <SelectValue placeholder="Choose a target Minecraft version" />
        </SelectTrigger>
        <SelectContent>
          {VERSION_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-sm)",
          color: "var(--text-tertiary)",
        }}
      >
        Leave blank to keep the same version
      </p>
    </div>
  );
}

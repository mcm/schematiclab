"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iamthemcmaster/ui";
import { KNOWN_VERSIONS } from "@/lib/schemlib/schematic-formats/version-mapping";

const VERSION_IDS: readonly string[] = Object.keys(KNOWN_VERSIONS);

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
      <Select
        value={value ?? undefined}
        onValueChange={(next) => onChange(next)}
      >
        <SelectTrigger
          style={{ width: "100%" }}
          aria-label="Target Minecraft version"
        >
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

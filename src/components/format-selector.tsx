"use client";

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iamthemcmaster/ui";
import type { SchematicFormatId } from "@/lib/convert";

interface FormatOption {
  id: SchematicFormatId;
  label: string;
}

const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: "Litematic", label: "Litematic (.litematic)" },
  { id: "Sponge[v1]", label: "Sponge v1 (.schem)" },
  { id: "Sponge[v2]", label: "Sponge v2 (.schem)" },
  { id: "Sponge[v3]", label: "Sponge v3 (.schem)" },
  { id: "Structure", label: "Structure (.nbt)" },
  { id: "BuildingGadgets[1.12]", label: "Building Gadgets 1.12 (.txt)" },
  {
    id: "BuildingGadgets[1.14.4-1.19.3]",
    label: "Building Gadgets 1.14.4–1.19.3 (.txt)",
  },
  { id: "BuildingGadgets2[1.20+]", label: "Building Gadgets 2 1.20+ (.txt)" },
  { id: "StructurizeBlueprint", label: "Structurize Blueprint (.blueprint)" },
  { id: "JSON", label: "schemlib JSON (.json)" },
];

const TRIGGER_ID = "output-format-trigger";

interface FormatSelectorProps {
  value: SchematicFormatId | null;
  onChange: (value: SchematicFormatId) => void;
}

export function FormatSelector({ value, onChange }: FormatSelectorProps) {
  const isDev = process.env.NODE_ENV === "development";

  const options = FORMAT_OPTIONS.filter((option) => {
    if (option.id === "JSON" && !isDev) return false;
    return true;
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <Label htmlFor={TRIGGER_ID}>Output format</Label>
      <Select
        value={value ?? undefined}
        onValueChange={(next) => onChange(next as SchematicFormatId)}
      >
        <SelectTrigger id={TRIGGER_ID} style={{ width: "100%" }}>
          <SelectValue placeholder="Choose a schematic type to output" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

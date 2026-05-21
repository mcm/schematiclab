"use client";

import {
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

interface FormatSelectorProps {
  value: SchematicFormatId | null;
  onChange: (value: SchematicFormatId) => void;
  excludedFormat?: SchematicFormatId | null;
}

export function FormatSelector({
  value,
  onChange,
  excludedFormat,
}: FormatSelectorProps) {
  const isDev = process.env.NODE_ENV === "development";

  const options = FORMAT_OPTIONS.filter((option) => {
    if (option.id === "JSON" && !isDev) return false;
    if (excludedFormat && option.id === excludedFormat) return false;
    return true;
  });

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(next) => onChange(next as SchematicFormatId)}
    >
      <SelectTrigger style={{ width: "100%" }} aria-label="Output format">
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
  );
}

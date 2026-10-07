import { DEFAULT_APPEARANCE, type Appearance } from "./shared";

// Both persisted preferences and IPC input use this boundary. Never accept CSS.
export function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== "object")
    throw new Error("Choose valid colours.");
  const data = value as Record<string, unknown>;
  const result = { ...DEFAULT_APPEARANCE };
  for (const key of ["background", "text", "accent"] as const) {
    if (typeof data[key] !== "string" || !/^#[\da-f]{6}$/i.test(data[key]))
      throw new Error("Use a six-digit hex colour, such as #83dab7.");
    result[key] = data[key].toLowerCase();
  }
  return result;
}

import type { AtBusJson } from "../types/index.ts";

export const isJson = (value: unknown): value is AtBusJson => {
  if (
    value === null || typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJson(item));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => isJson(item));
  }
  return false;
};

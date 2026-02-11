import { AtBusErrorCode } from "../errors.ts";
import type { AtBusFailure } from "../types/index.ts";
import { isJson } from "./is-json.ts";

export const normalizeErrorCode = (
  value: unknown,
): AtBusFailure["error"]["code"] => {
  if (typeof value !== "string") {
    return AtBusErrorCode.InternalError;
  }

  const allCodes = Object.values(AtBusErrorCode) as string[];
  if (allCodes.includes(value)) {
    return value as AtBusFailure["error"]["code"];
  }

  return AtBusErrorCode.InternalError;
};

export const mapError = (
  error: unknown,
  route: string,
): AtBusFailure["error"] => {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = normalizeErrorCode(record.code);
    const message = typeof record.message === "string"
      ? record.message
      : error instanceof Error
      ? error.message
      : "Unknown error";
    const details = isJson(record.details) ? record.details : undefined;
    const retriable = typeof record.retriable === "boolean"
      ? record.retriable
      : code === AtBusErrorCode.Timeout || code === AtBusErrorCode.TransportError;
    return { code, message, route, retriable, details };
  }

  return {
    code: AtBusErrorCode.InternalError,
    message: error instanceof Error ? error.message : "Unknown error",
    route,
    retriable: false,
  };
};

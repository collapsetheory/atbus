import { ATBUS_PROTOCOL_VERSION } from "../errors.ts";
import type { AtBusCancel, AtBusFailure, AtBusRequest, AtBusResponse } from "../types/index.ts";

export const isAtBusFailure = (value: unknown): value is AtBusFailure => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;
  return record.type === "atbus:response" &&
    record.v === ATBUS_PROTOCOL_VERSION &&
    record.ok === false &&
    typeof record.id === "string" &&
    (typeof record.sourceId === "string" || typeof record.sourceId === "undefined") &&
    (typeof record.targetId === "string" || typeof record.targetId === "undefined") &&
    (typeof record.bus === "string" || typeof record.bus === "undefined") &&
    !!error &&
    typeof error.code === "string" &&
    typeof error.message === "string";
};

export const isAtBusResponse = (value: unknown): value is AtBusResponse<unknown> => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.v !== ATBUS_PROTOCOL_VERSION ||
    record.type !== "atbus:response" ||
    typeof record.id !== "string" ||
    typeof record.ok !== "boolean" ||
    (typeof record.sourceId !== "string" && typeof record.sourceId !== "undefined") ||
    (typeof record.targetId !== "string" && typeof record.targetId !== "undefined") ||
    (typeof record.bus !== "string" && typeof record.bus !== "undefined")
  ) {
    return false;
  }

  if (record.ok === true) {
    return "data" in record;
  }

  return isAtBusFailure(value);
};

export const isAtBusRequest = (value: unknown): value is AtBusRequest<unknown> => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.v === ATBUS_PROTOCOL_VERSION &&
    record.type === "atbus:request" &&
    typeof record.id === "string" &&
    typeof record.route === "string" &&
    (typeof record.sourceId === "string" || typeof record.sourceId === "undefined") &&
    (typeof record.targetId === "string" || typeof record.targetId === "undefined") &&
    (typeof record.bus === "string" || typeof record.bus === "undefined");
};

export const isAtBusCancel = (value: unknown): value is AtBusCancel => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.v === ATBUS_PROTOCOL_VERSION &&
    record.type === "atbus:cancel" &&
    typeof record.id === "string" &&
    (typeof record.sourceId === "string" || typeof record.sourceId === "undefined") &&
    (typeof record.targetId === "string" || typeof record.targetId === "undefined") &&
    (typeof record.bus === "string" || typeof record.bus === "undefined");
};

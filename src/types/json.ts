import type { AtBusPrimitive } from "./primitive.ts";

/** Recursive JSON value accepted by AtBus request and response payloads. */
export type AtBusJson =
  | AtBusPrimitive
  | AtBusJson[]
  | { [key: string]: AtBusJson };

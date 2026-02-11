import type { AtBusPrimitive } from "./primitive.ts";

export type AtBusJson =
  | AtBusPrimitive
  | AtBusJson[]
  | { [key: string]: AtBusJson };

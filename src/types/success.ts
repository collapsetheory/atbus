import type { AtBusJson } from "./json.ts";

export type AtBusSuccess<T = AtBusJson> = {
  v: number;
  type: "atbus:response";
  id: string;
  ok: true;
  data: T;
  sourceId?: string;
  targetId?: string;
  bus?: string;
};

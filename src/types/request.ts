import type { AtBusJson } from "./json.ts";

export type AtBusRequest<T = AtBusJson> = {
  v: number;
  type: "atbus:request";
  id: string;
  route: string;
  payload: T;
  sourceId?: string;
  targetId?: string;
  bus?: string;
};

import type { AtBusFailure } from "./failure.ts";
import type { AtBusJson } from "./json.ts";
import type { AtBusSuccess } from "./success.ts";

export type AtBusResponse<T = AtBusJson> = AtBusSuccess<T> | AtBusFailure;

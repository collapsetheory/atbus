import type { AtBusFailure } from "./failure.ts";
import type { AtBusJson } from "./json.ts";
import type { AtBusSuccess } from "./success.ts";

/** Union of successful and failed AtBus responses. */
export type AtBusResponse<T = AtBusJson> = AtBusSuccess<T> | AtBusFailure;

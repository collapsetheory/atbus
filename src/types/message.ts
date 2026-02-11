import type { AtBusCancel } from "./cancel.ts";
import type { AtBusJson } from "./json.ts";
import type { AtBusRequest } from "./request.ts";
import type { AtBusResponse } from "./response.ts";

/** Union of all AtBus envelope variants. */
export type AtBusMessage<T = AtBusJson> =
  | AtBusRequest<T>
  | AtBusResponse<T>
  | AtBusCancel;

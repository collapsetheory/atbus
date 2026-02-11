import type { AtBusHandlerContext } from "./handler-context.ts";
import type { AtBusJson } from "./json.ts";

/** Route handler signature for typed request and response payloads. */
export type AtBusHandler<TIn = AtBusJson, TOut = AtBusJson> = (
  payload: TIn,
  context: AtBusHandlerContext,
) => Promise<TOut> | TOut;

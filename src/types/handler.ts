import type { AtBusHandlerContext } from "./handler-context.ts";
import type { AtBusJson } from "./json.ts";

export type AtBusHandler<TIn = AtBusJson, TOut = AtBusJson> = (
  payload: TIn,
  context: AtBusHandlerContext,
) => Promise<TOut> | TOut;

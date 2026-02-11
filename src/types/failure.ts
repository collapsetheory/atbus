import type { AtBusErrorCode } from "../errors.ts";
import type { AtBusJson } from "./json.ts";

/** Failed response envelope including a structured error payload. */
export type AtBusFailure = {
  v: number;
  type: "atbus:response";
  id: string;
  ok: false;
  sourceId?: string;
  targetId?: string;
  bus?: string;
  error: {
    code: AtBusErrorCode;
    message: string;
    route?: string;
    retriable?: boolean;
    details?: AtBusJson;
  };
};

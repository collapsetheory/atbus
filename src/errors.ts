/** Wire protocol version used by AtBus envelopes. */
export const ATBUS_PROTOCOL_VERSION = 1;

/** Canonical AtBus error codes used by clients and servers. */
export const AtBusErrorCode = {
  RouteNotFound: "ROUTE_NOT_FOUND",
  Timeout: "TIMEOUT",
  InternalError: "INTERNAL_ERROR",
  InvalidMessage: "INVALID_MESSAGE",
  PayloadTooLarge: "PAYLOAD_TOO_LARGE",
  Forbidden: "FORBIDDEN",
  ClientClosed: "CLIENT_CLOSED",
  Cancelled: "CANCELLED",
  TransportError: "TRANSPORT_ERROR",
} as const;

/** Union of all possible values from {@link AtBusErrorCode}. */
export type AtBusErrorCode = (typeof AtBusErrorCode)[keyof typeof AtBusErrorCode];

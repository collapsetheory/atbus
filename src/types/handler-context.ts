/** Metadata supplied to route handlers for each request invocation. */
export type AtBusHandlerContext = {
  route: string;
  matchedRoute?: string;
  params: Record<string, string>;
  signal: AbortSignal;
};

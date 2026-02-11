export type AtBusHandlerContext = {
  route: string;
  matchedRoute?: string;
  params: Record<string, string>;
  signal: AbortSignal;
};

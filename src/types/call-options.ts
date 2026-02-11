/** Per-call overrides for timeout and cancellation behavior. */
export type AtBusCallOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

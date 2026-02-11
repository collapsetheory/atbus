/** Client configuration for startup, timeouts, limits, and addressing defaults. */
export type AtBusClientOptions = {
  timeoutMs?: number;
  autoStart?: boolean;
  maxPayloadBytes?: number;
  clientId?: string;
  targetId?: string;
  bus?: string;
};

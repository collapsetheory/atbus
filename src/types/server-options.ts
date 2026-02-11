export type AtBusServerOptions = {
  autoStart?: boolean;
  maxPayloadBytes?: number;
  canHandle?: (route: string) => boolean;
  serverId?: string;
  bus?: string;
  acceptUnaddressed?: boolean;
};

export type AtBusEndpoint = {
  postMessage: (message: unknown) => void;
  close: () => void;
  start?: () => void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
};

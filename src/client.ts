/**
 * AtBus client entrypoint for request/response RPC over a message endpoint.
 * @module
 */
import { ATBUS_PROTOCOL_VERSION, AtBusErrorCode } from "./errors.ts";
import type {
  AtBusCallOptions,
  AtBusCancel,
  AtBusClientOptions,
  AtBusEndpoint,
  AtBusFailure,
  AtBusJson,
  AtBusRequest,
} from "./types/index.ts";
import { isAtBusResponse } from "./helpers/guards.ts";
import { payloadSizeBytes } from "./helpers/payload-size-bytes.ts";
import { validateRoute } from "./helpers/validate-route.ts";

type PendingRequest = {
  resolve: (value: AtBusJson) => void;
  reject: (reason?: unknown) => void;
  timer: number;
};

/** Sends typed requests and resolves responses from an AtBus server. */
export class AtBusClient {
  #endpoint: AtBusEndpoint;
  #pending = new Map<string, PendingRequest>();
  #defaultTimeoutMs: number;
  #started = false;
  #closed = false;
  #maxPayloadBytes: number;
  #clientId: string;
  #targetId?: string;
  #bus?: string;

  constructor(endpoint: AtBusEndpoint, options?: AtBusClientOptions) {
    this.#endpoint = endpoint;
    this.#defaultTimeoutMs = options?.timeoutMs ?? 10_000;
    this.#maxPayloadBytes = options?.maxPayloadBytes ?? 2 * 1024 * 1024;
    this.#clientId = options?.clientId ?? crypto.randomUUID();
    this.#targetId = options?.targetId;
    this.#bus = options?.bus;
    if (options?.autoStart !== false) {
      this.start();
    }
  }

  start(): this {
    if (this.#closed || this.#started) return this;
    this.#endpoint.onmessage = (event: MessageEvent<unknown>) => {
      this.#handleMessage(event.data);
    };
    this.#endpoint.onmessageerror = () => {
      // Ignore malformed message payloads.
    };
    this.#endpoint.start?.();
    this.#started = true;
    return this;
  }

  stop(reason = "AtBus client stopped"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#started = false;
    this.#endpoint.onmessage = null;
    this.#endpoint.onmessageerror = null;
    for (const [requestId, pending] of this.#pending.entries()) {
      clearTimeout(pending.timer);
      this.#sendCancel(requestId);
      pending.reject(
        new AtBusRemoteError(
          {
            code: AtBusErrorCode.ClientClosed,
            message: reason,
            retriable: false,
          },
          requestId,
        ),
      );
    }
    this.#pending.clear();
    this.#endpoint.close();
  }

  call<TOut = AtBusJson, TIn = AtBusJson>(
    route: string,
    payload: TIn,
    options?: AtBusCallOptions,
  ): Promise<TOut> {
    if (this.#closed) {
      return Promise.reject(
        new AtBusRemoteError(
          {
            code: AtBusErrorCode.ClientClosed,
            message: "AtBus client is closed",
            route,
            retriable: false,
          },
          "local",
        ),
      );
    }
    if (!this.#started) {
      this.start();
    }

    validateRoute(route);
    if (payloadSizeBytes(payload) > this.#maxPayloadBytes) {
      return Promise.reject(
        new AtBusRemoteError(
          {
            code: AtBusErrorCode.PayloadTooLarge,
            message: `Payload exceeds ${this.#maxPayloadBytes} bytes`,
            route,
            retriable: false,
          },
          "local",
        ),
      );
    }

    const requestId = crypto.randomUUID();
    const timeoutMs = options?.timeoutMs ?? this.#defaultTimeoutMs;
    const request: AtBusRequest<TIn> = {
      v: ATBUS_PROTOCOL_VERSION,
      type: "atbus:request",
      id: requestId,
      route,
      payload,
      sourceId: this.#clientId,
      targetId: this.#targetId,
      bus: this.#bus,
    };

    return new Promise<TOut>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        this.#sendCancel(requestId);
        reject(
          new AtBusRemoteError(
            {
              code: AtBusErrorCode.Timeout,
              message: `AtBus request timed out for route ${route}`,
              route,
              retriable: true,
            },
            requestId,
          ),
        );
      }, timeoutMs);

      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as TOut),
        reject,
        timer,
      });

      try {
        this.#endpoint.postMessage(request);
      } catch {
        clearTimeout(timer);
        this.#pending.delete(requestId);
        reject(
          new AtBusRemoteError(
            {
              code: AtBusErrorCode.TransportError,
              message: "Failed to post AtBus request",
              route,
              retriable: true,
            },
            requestId,
          ),
        );
        return;
      }

      if (options?.signal) {
        const onAbort = () => {
          clearTimeout(timer);
          this.#pending.delete(requestId);
          this.#sendCancel(requestId);
          reject(
            new AtBusRemoteError(
              {
                code: AtBusErrorCode.Cancelled,
                message: "AtBus request aborted",
                route,
                retriable: false,
              },
              requestId,
            ),
          );
        };

        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  }

  close(): void {
    this.stop("AtBus client closed");
  }

  #handleMessage(data: unknown): void {
    if (!isAtBusResponse(data)) return;
    const response = data;
    if (response.targetId && response.targetId !== this.#clientId) {
      return;
    }
    if (this.#targetId && response.sourceId && response.sourceId !== this.#targetId) {
      return;
    }
    if (this.#bus && response.bus && response.bus !== this.#bus) {
      return;
    }
    const pending = this.#pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.#pending.delete(response.id);

    if (response.ok) {
      pending.resolve(response.data as AtBusJson);
      return;
    }

    pending.reject(new AtBusRemoteError(response.error, response.id));
  }

  #sendCancel(id: string): void {
    const cancel: AtBusCancel = {
      v: ATBUS_PROTOCOL_VERSION,
      type: "atbus:cancel",
      id,
      sourceId: this.#clientId,
      targetId: this.#targetId,
      bus: this.#bus,
    };
    try {
      this.#endpoint.postMessage(cancel);
    } catch {
      // Best effort only.
    }
  }
}

/** Error object representing a remote or transport-level AtBus failure. */
export class AtBusRemoteError extends Error {
  readonly code: string;
  readonly route?: string;
  readonly retriable?: boolean;
  readonly details?: AtBusJson;
  readonly requestId: string;

  constructor(error: AtBusFailure["error"], requestId: string) {
    super(`${error.code}: ${error.message}`);
    this.name = "AtBusRemoteError";
    this.code = error.code;
    this.route = error.route;
    this.retriable = error.retriable;
    this.details = error.details;
    this.requestId = requestId;
  }
}

export { AtBusClient as AtBus };
export default AtBusClient;

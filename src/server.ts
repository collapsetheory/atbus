/** AtBus server entrypoint for route registration and request handling. */
import { ATBUS_PROTOCOL_VERSION, AtBusErrorCode } from "./errors.ts";
import type {
  AtBusEndpoint,
  AtBusFailure,
  AtBusHandler,
  AtBusJson,
  AtBusResponse,
  AtBusServerOptions,
  AtBusSuccess,
} from "./types/index.ts";
import { isAtBusCancel, isAtBusRequest } from "./helpers/guards.ts";
import { mapError } from "./helpers/map-error.ts";
import { matchRoute } from "./helpers/match-route.ts";
import { payloadSizeBytes } from "./helpers/payload-size-bytes.ts";
import { validateRoute } from "./helpers/validate-route.ts";

type RouteDef = {
  route: string | RegExp;
  handler: AtBusHandler<unknown, unknown>;
};

/** Registers route handlers and dispatches request/response envelopes. */
export class AtBusServer {
  #endpoint: AtBusEndpoint;
  #routes: RouteDef[] = [];
  #started = false;
  #closed = false;
  #inFlight = new Map<string, AbortController>();
  #maxPayloadBytes: number;
  #canHandle?: (route: string) => boolean;
  #serverId: string;
  #bus?: string;
  #acceptUnaddressed: boolean;

  constructor(endpoint: AtBusEndpoint, options?: AtBusServerOptions) {
    this.#endpoint = endpoint;
    this.#maxPayloadBytes = options?.maxPayloadBytes ?? 2 * 1024 * 1024;
    this.#canHandle = options?.canHandle;
    this.#serverId = options?.serverId ?? crypto.randomUUID();
    this.#bus = options?.bus;
    this.#acceptUnaddressed = options?.acceptUnaddressed ?? true;
    if (options?.autoStart !== false) {
      this.start();
    }
  }

  start(): this {
    if (this.#closed || this.#started) return this;
    this.#endpoint.onmessage = (event: MessageEvent<unknown>) => {
      void this.#handleEnvelope(event.data);
    };
    this.#endpoint.onmessageerror = () => {
      // Ignore malformed messages and keep the port alive.
    };
    this.#endpoint.start?.();
    this.#started = true;
    return this;
  }

  stop(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#started = false;
    this.#endpoint.onmessage = null;
    this.#endpoint.onmessageerror = null;
    this.#routes = [];
    for (const ctrl of this.#inFlight.values()) {
      ctrl.abort();
    }
    this.#inFlight.clear();
    this.#endpoint.close();
  }

  close(): void {
    this.stop();
  }

  at<TIn = AtBusJson, TOut = AtBusJson>(
    route: string | RegExp,
    handler: AtBusHandler<TIn, TOut>,
  ): this {
    validateRoute(route);
    this.#routes.push({
      route,
      handler: handler as AtBusHandler<unknown, unknown>,
    });
    return this;
  }

  async #handleEnvelope(data: unknown): Promise<void> {
    if (this.#closed) return;

    if (isAtBusCancel(data)) {
      if (!this.#matchesAddressing(data.sourceId, data.targetId, data.bus)) {
        return;
      }
      this.#inFlight.get(data.id)?.abort();
      return;
    }

    if (!isAtBusRequest(data)) return;

    const request = data;
    if (!this.#matchesAddressing(request.sourceId, request.targetId, request.bus)) {
      return;
    }

    if (this.#canHandle && !this.#canHandle(request.route)) {
      this.#sendFailure(request.id, {
        code: AtBusErrorCode.Forbidden,
        message: `Route is not allowed: ${request.route}`,
        route: request.route,
        retriable: false,
      }, request.sourceId, request.bus);
      return;
    }

    if (payloadSizeBytes(request.payload) > this.#maxPayloadBytes) {
      this.#sendFailure(request.id, {
        code: AtBusErrorCode.PayloadTooLarge,
        message: `Payload exceeds ${this.#maxPayloadBytes} bytes`,
        route: request.route,
        retriable: false,
      }, request.sourceId, request.bus);
      return;
    }

    const match = this.#routes
      .map((entry) => ({
        entry,
        params: matchRoute(entry.route, request.route),
      }))
      .find((item) => item.params !== null);

    if (!match) {
      this.#sendFailure(request.id, {
        code: AtBusErrorCode.RouteNotFound,
        message: `No route registered for ${request.route}`,
        route: request.route,
        retriable: false,
      }, request.sourceId, request.bus);
      return;
    }

    const controller = new AbortController();
    this.#inFlight.set(request.id, controller);

    try {
      const matchedRoute = typeof match.entry.route === "string"
        ? match.entry.route
        : String(match.entry.route);
      const result = await match.entry.handler(request.payload, {
        route: request.route,
        matchedRoute,
        params: match.params ?? {},
        signal: controller.signal,
      });

      const response: AtBusSuccess<unknown> = {
        v: ATBUS_PROTOCOL_VERSION,
        type: "atbus:response",
        id: request.id,
        ok: true,
        data: result,
        sourceId: this.#serverId,
        targetId: request.sourceId,
        bus: request.bus ?? this.#bus,
      };
      this.#send(response);
    } catch (error) {
      const response: AtBusFailure = {
        v: ATBUS_PROTOCOL_VERSION,
        type: "atbus:response",
        id: request.id,
        ok: false,
        sourceId: this.#serverId,
        targetId: request.sourceId,
        bus: request.bus ?? this.#bus,
        error: mapError(error, request.route),
      };
      this.#send(response);
    } finally {
      this.#inFlight.delete(request.id);
    }
  }

  #send(response: AtBusResponse<unknown>): void {
    if (this.#closed) return;
    this.#endpoint.postMessage(response);
  }

  #sendFailure(
    id: string,
    error: AtBusFailure["error"],
    targetId?: string,
    bus?: string,
  ): void {
    this.#send({
      v: ATBUS_PROTOCOL_VERSION,
      type: "atbus:response",
      id,
      ok: false,
      sourceId: this.#serverId,
      targetId,
      bus,
      error,
    });
  }

  #matchesAddressing(
    sourceId?: string,
    targetId?: string,
    bus?: string,
  ): boolean {
    if (sourceId && sourceId === this.#serverId) {
      return false;
    }
    if (targetId && targetId !== this.#serverId) {
      return false;
    }
    if (!targetId && !this.#acceptUnaddressed) {
      return false;
    }
    if (this.#bus && bus && bus !== this.#bus) {
      return false;
    }
    if (!this.#bus && bus) {
      return false;
    }
    return true;
  }
}

export { AtBusServer as AtBus };
export default AtBusServer;

import { AtBusClient, AtBusRemoteError } from "../src/client.ts";
import { AtBusErrorCode } from "../src/errors.ts";
import { AtBusServer } from "../src/server.ts";

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function assertRejects(
  fn: () => Promise<unknown>,
  expectedCtor: new (...args: never[]) => Error,
  messageIncludes: string,
): Promise<void> {
  try {
    await fn();
    throw new Error("Expected promise to reject");
  } catch (error) {
    if (!(error instanceof expectedCtor)) {
      throw new Error(`Expected ${expectedCtor.name}, got ${String(error)}`);
    }
    if (!String(error.message).includes(messageIncludes)) {
      throw new Error(
        `Expected error message to include '${messageIncludes}', got '${error.message}'`,
      );
    }
  }
}

Deno.test("atbus: call returns handler result", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new AtBusServer(port1);
  server.at("/ping", () => ({ pong: true }));

  const client = new AtBusClient(port2);
  const result = await client.call<{ pong: boolean }>("/ping", null);

  assertEquals(result.pong, true);
  client.close();
  server.close();
});

Deno.test("atbus: route params are parsed", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new AtBusServer(port1);
  server.at("/people/:id", (_payload, ctx) => ({ id: ctx.params.id }));

  const client = new AtBusClient(port2);
  const result = await client.call<{ id: string }>("/people/abc123", null);

  assertEquals(result.id, "abc123");
  client.close();
  server.close();
});

Deno.test("atbus: missing route returns ROUTE_NOT_FOUND", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new AtBusServer(port1);
  const client = new AtBusClient(port2);

  await assertRejects(
    () => client.call("/missing", null),
    AtBusRemoteError,
    AtBusErrorCode.RouteNotFound,
  );

  client.close();
  server.close();
});

Deno.test("atbus: timeout returns TIMEOUT", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new AtBusServer(port1);
  server.at("/slow", async (_payload, ctx) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      }, { once: true });
    });
    return { ok: true };
  });

  const client = new AtBusClient(port2, { timeoutMs: 20 });

  await assertRejects(
    () => client.call("/slow", null),
    AtBusRemoteError,
    AtBusErrorCode.Timeout,
  );

  client.close();
  server.close();
});

Deno.test("atbus: cancellation aborts handler", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = new AtBusServer(port1);

  server.at("/wait", async (_payload, ctx) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 200);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted by client"));
      }, { once: true });
    });
    return { ok: true };
  });

  const client = new AtBusClient(port2, { timeoutMs: 1000 });
  const controller = new AbortController();

  const abortTimer = setTimeout(() => controller.abort(), 20);

  await assertRejects(
    () => client.call("/wait", null, { signal: controller.signal }),
    AtBusRemoteError,
    AtBusErrorCode.Cancelled,
  );

  clearTimeout(abortTimer);
  client.close();
  server.close();
});

Deno.test("atbus: broadcast channel supports client-targeted server routing", async () => {
  const channelName = `atbus-${crypto.randomUUID()}`;
  const serverChannelA = new BroadcastChannel(channelName);
  const serverChannelB = new BroadcastChannel(channelName);
  const clientChannel = new BroadcastChannel(channelName);

  const serverA = new AtBusServer(serverChannelA, {
    serverId: "server-a",
    bus: "core",
    acceptUnaddressed: false,
  });
  const serverB = new AtBusServer(serverChannelB, {
    serverId: "server-b",
    bus: "core",
    acceptUnaddressed: false,
  });

  serverA.at("/who", () => ({ server: "A" }));
  serverB.at("/who", () => ({ server: "B" }));

  const client = new AtBusClient(clientChannel, {
    clientId: "client-1",
    targetId: "server-a",
    bus: "core",
    timeoutMs: 500,
  });

  const result = await client.call<{ server: string }>("/who", null);
  assertEquals(result.server, "A");

  client.close();
  serverA.close();
  serverB.close();
});

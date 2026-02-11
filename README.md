# AtBus

A typed **request/response message bus** for `MessagePort` and `BroadcastChannel` in TypeScript. AtBus enables route-based RPC patterns with full support for timeouts, cancellation, and structured error handling.

> **Related:** See [PushBus](../pushbus) for a **publish/subscribe** alternative when you need simple fire-and-forget event distribution.

## Quick Overview

AtBus is a **request/response system** with route handlers:
- **Clients** make requests to routes and wait for responses
- **Servers** register route handlers that process requests
- **Full-duplex** with request correlation, timeouts, and cancellation
- Built-in **error codes**, **route parameters**, and **payload guardrails**

**Use AtBus when:**
- You need request/response patterns (call and wait for results)
- You need route parameters (e.g., `/users/:id/posts/:postId`)
- You need timeout handling and request cancellation
- You want structured error codes and error information
- Handler logic must run until completion or be cancellable

**Use [PushBus](../pushbus) instead if:**
- You only need fire-and-forget event distribution
- You don't need responses from handlers
- You want simpler topic-based filtering
- You need many-to-many pub/sub patterns

## Installation

### NPM/Package Manager
```bash
npm install @collapse-theory/atbus
```

### Deno
```ts
import { AtBusClient, AtBusServer } from "https://deno.land/x/atbus@0.1.0/src/index.ts";
```

### TypeScript/ES Modules
```ts
import { AtBusClient, AtBusServer } from "@collapse-theory/atbus";
```

## Core Concepts

### Routes
- Routes are **slash-delimited** strings starting with `/`
- Can include **route parameters**: `/users/:id`, `/posts/:postId/comments/:commentId`
- Can be **regex patterns**: `^/api/v\d+/.*`
- Examples: `/hello`, `/users/123`, `/api/v1/data`

### Request/Response
- **Client** sends a request to a route
- **Server** matches the route and executes the handler
- Handler returns data that becomes the response
- If handler throws, the error is sent back as a failure

### Handler Cancellation
- Handlers receive an `AbortSignal` in the context
- When the client cancels or times out, the signal fires
- Handler can listen and clean up resources

### Addressing (Optional)
When using `BroadcastChannel`, you can target specific servers and clients:
- `sourceId`: Identifies the requester
- `targetId`: Routes request to specific server
- `bus`: Isolates groups of clients/servers by bus name

---

## Getting Started

### Basic Usage: MessagePort (Window + Worker)

**Main thread (Client):**
```ts
// main.ts
import { AtBusClient } from "@collapse-theory/atbus";

const worker = new Worker("./worker.ts", { type: "module" });
const { port1, port2 } = new MessageChannel();

// Send port to worker
worker.postMessage({ type: "init", port: port2 }, [port2]);

// Create client
const client = new AtBusClient(port1);

// Make a request and wait for response
try {
  const result = await client.call<{ greeting: string }, { name: string }>(
    "/greet",
    { name: "Alice" }
  );
  console.log(result.greeting);  // "Hello, Alice!"
} catch (err) {
  if (err instanceof AtBusRemoteError) {
    console.error(`Error: ${err.code}: ${err.message}`);
  }
}
```

**Worker thread (Server):**
```ts
// worker.ts
import { AtBusServer } from "@collapse-theory/atbus";

self.onmessage = (event) => {
  if (event.data?.type !== "init") return;
  
  const port = event.ports[0];
  if (!port) return;

  // Create server
  const server = new AtBusServer(port);

  // Register route handler
  server.at<{ name: string }, { greeting: string }>(
    "/greet",
    (payload) => {
      return { greeting: `Hello, ${payload.name}!` };
    }
  );

  console.log("AtBus server started");
};
```

### Route Parameters

Extract parameters from the route:

**Client:**
```ts
const user = await client.call<{ id: string; email: string }>(
  "/users/42/profile",
  null
);
```

**Server:**
```ts
server.at<null, { id: string; email: string }>(
  "/users/:userId/profile",
  (payload, ctx) => {
    const userId = ctx.params.userId;
    console.log(`Fetching profile for user ${userId}`);
    return { id: userId, email: "user@example.com" };
  }
);
```

### Timeouts

Handle slow or hanging requests:

**Client:**
```ts
const client = new AtBusClient(port, {
  timeoutMs: 5000,  // Default timeout for all requests
});

try {
  const result = await client.call("/slow-op", null);
} catch (err) {
  if (err instanceof AtBusRemoteError && err.code === AtBusErrorCode.Timeout) {
    console.error("Request timed out");
  }
}
```

Per-request timeout:
```ts
const result = await client.call("/operation", payload, {
  timeoutMs: 10000,  // Override default for this call
});
```

### Request Cancellation

Cancel in-flight requests using `AbortSignal`:

**Client:**
```ts
const controller = new AbortController();

// Start a long-running request
const promise = client.call("/long-op", null, {
  signal: controller.signal,
});

// Cancel after 1 second
setTimeout(() => controller.abort(), 1000);

try {
  await promise;
} catch (err) {
  if (err instanceof AtBusRemoteError && err.code === AtBusErrorCode.Cancelled) {
    console.log("Request was cancelled");
  }
}
```

**Server (receiving the cancellation):**
```ts
server.at("/long-op", async (payload, ctx) => {
  try {
    // Listen for abort signal
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 30000);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("aborted"));
      });
    });
    return { result: "success" };
  } catch (e) {
    // When client aborts, handler can clean up here
    console.log("Handler was aborted");
    throw e;
  }
});
```

### BroadcastChannel with Addressing

Target specific servers when using `BroadcastChannel`:

```ts
import { AtBusClient, AtBusServer } from "@collapse-theory/atbus";

const channelName = "app-bus";

// Server A (handles authentication)
const serverA = new AtBusServer(new BroadcastChannel(channelName), {
  serverId: "auth-server",
  bus: "core",
  acceptUnaddressed: false,
});

serverA.at("/login", async (payload) => {
  return { token: "jwt-token" };
});

// Server B (handles storage)
const serverB = new AtBusServer(new BroadcastChannel(channelName), {
  serverId: "storage-server",
  bus: "core",
  acceptUnaddressed: false,
});

serverB.at("/files/:fileId", async (payload, ctx) => {
  const fileId = ctx.params.fileId;
  return { fileId, content: "..." };
});

// Client routes to specific server
const authClient = new AtBusClient(new BroadcastChannel(channelName), {
  clientId: "app-client",
  targetId: "auth-server",  // Only talk to auth server
  bus: "core",
});

const storageClient = new AtBusClient(new BroadcastChannel(channelName), {
  clientId: "app-client",
  targetId: "storage-server",  // Only talk to storage server
  bus: "core",
});

const token = await authClient.call("/login", { user: "alice" });
const file = await storageClient.call("/files/doc-123", null);
```

---

## API Reference

### AtBusClient

#### Constructor
```ts
new AtBusClient(endpoint: AtBusEndpoint, options?: AtBusClientOptions)
```

#### Options
```ts
type AtBusClientOptions = {
  timeoutMs?: number;            // Default timeout for requests (default: 10000ms)
  autoStart?: boolean;           // Start listening immediately (default: true)
  maxPayloadBytes?: number;      // Payload size limit (default: 2MB)
  clientId?: string;             // Client identifier (auto-generated if omitted)
  targetId?: string;             // Server to target (for BroadcastChannel)
  bus?: string;                  // Bus name for isolation
};
```

#### Methods

**`call<TOut, TIn>(route, payload, options?): Promise<TOut>`**
- Makes a request to a route
- Waits for the handler result
- Throws `AtBusRemoteError` on handler errors or timeouts

```ts
const result = await client.call<ResponseType, RequestType>(
  "/users/123/data",
  { filter: "active" },
  { timeoutMs: 5000 }
);
```

**`start(): this`**
- Manually start listening (if `autoStart: false`)
- Returns self for chaining

**`stop(reason?): void`**
- Stops listening and rejects all pending requests
- Sends cancellation to in-flight handlers

**`close(): void`**
- Alias for `stop()`

---

### AtBusServer

#### Constructor
```ts
new AtBusServer(endpoint: AtBusEndpoint, options?: AtBusServerOptions)
```

#### Options
```ts
type AtBusServerOptions = {
  autoStart?: boolean;           // Start listening immediately (default: true)
  maxPayloadBytes?: number;      // Payload size limit (default: 2MB)
  serverId?: string;             // Server identifier (auto-generated if omitted)
  bus?: string;                  // Bus name for isolation
  acceptUnaddressed?: boolean;   // Accept unaddressed messages (default: true)
  canHandle?: (route: string) => boolean;  // Filter allowed routes
};
```

#### Methods

**`at<TIn, TOut>(route, handler): this`**
- Registers a route handler
- Route can be a string (with optional params) or regex
- Handler is called with `(payload, context)`
- Returns self for chaining

```ts
server.at<RequestType, ResponseType>(
  "/users/:userId/profile",
  async (payload, ctx) => {
    const userId = ctx.params.userId;
    // Handler logic
    return { userId, profile: {...} };
  }
);

// Regex route
server.at(/^\/api\/v\d+\/.*/, (payload) => ({...}));
```

**`start(): this`**
- Manually start the server (if `autoStart: false`)

**`stop(): void`**
- Stops the server and aborts all in-flight handlers

**`close(): void`**
- Alias for `stop()`

---

### Handler Context

What the handler receives:
```ts
type AtBusHandlerContext = {
  route: string;           // The route that was called (e.g., "/users/123/profile")
  matchedRoute?: string;   // The pattern that matched (e.g., "/users/:userId/profile")
  params: Record<string, string>;  // Extracted route params (e.g., {userId: "123"})
  signal: AbortSignal;     // Fires when client cancels or times out
};
```

---

### Error Handling

**Remote Errors:**
```ts
try {
  await client.call("/operation", payload);
} catch (err) {
  if (err instanceof AtBusRemoteError) {
    console.log(err.code);      // "ROUTE_NOT_FOUND", "TIMEOUT", etc.
    console.log(err.message);   // Human-readable error
    console.log(err.route);     // Route that failed
    console.log(err.retriable); // Should client retry?
    console.log(err.details);   // Optional structured data
  }
}
```

**Error Codes:**
```ts
AtBusErrorCode.RouteNotFound      // No handler registered for route
AtBusErrorCode.Timeout            // Request exceeded timeout
AtBusErrorCode.Cancelled          // Client cancelled request
AtBusErrorCode.InternalError      // Unhandled exception in handler
AtBusErrorCode.PayloadTooLarge    // Request/response exceeds size limit
AtBusErrorCode.InvalidMessage     // Malformed request
AtBusErrorCode.Forbidden          // canHandle() rejected route
AtBusErrorCode.ClientClosed       // Client stopped before response
AtBusErrorCode.TransportError     // Port/channel communication failed
```

**Handler Errors:**
When a handler throws, AtBus captures the error:
```ts
server.at("/operation", async () => {
  throw new Error("Something went wrong");
});

// Client receives:
try {
  await client.call("/operation", null);
} catch (err) {
  err.code;    // "INTERNAL_ERROR"
  err.message; // "Something went wrong"
  err.route;   // "/operation"
}
```

---

## Common Patterns

### Multiple Buses to Same Worker

Separate concerns using different buses:

**Client:**
```ts
const worker = new Worker("./worker.ts", { type: "module" });

function createBus(name: string) {
  const { port1, port2 } = new MessageChannel();
  worker.postMessage({ type: "init-bus", name }, [port2]);
  return new AtBusClient(port1);
}

const userBus = createBus("users");
const storageBus = createBus("storage");

const user = await userBus.call("/profile", null);
const file = await storageBus.call("/files/latest", null);
```

**Server:**
```ts
const buses = new Map<string, AtBusServer>();

self.onmessage = (event) => {
  if (event.data?.type !== "init-bus") return;
  
  const { name } = event.data;
  const port = event.ports[0];
  if (!port) return;

  const server = new AtBusServer(port);
  buses.set(name, server);

  if (name === "users") {
    server.at("/profile", () => ({...}));
  }
  if (name === "storage") {
    server.at("/files/:id", (_, ctx) => ({...}));
  }
};
```

### Route Sharding

Split routes across multiple servers:
```ts
const serverA = new AtBusServer(port, {
  serverId: "server-a",
  canHandle: (route) => route.startsWith("/users/"),
});

const serverB = new AtBusServer(port, {
  serverId: "server-b",
  canHandle: (route) => route.startsWith("/posts/"),
});
```

### Error Recovery with Retries

Implement client-side retry logic:
```ts
async function callWithRetries(
  client: AtBusClient,
  route: string,
  payload: unknown,
  maxRetries = 3
) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.call(route, payload);
    } catch (err) {
      lastError = err;
      if (!(err instanceof AtBusRemoteError) || !err.retriable) {
        throw err;
      }
      // Exponential backoff
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 100));
    }
  }
  
  throw lastError;
}
```

---

## Comparison with PushBus

| Feature | AtBus | PushBus |
|---------|-------|---------|
| **Pattern** | Request/Response | Publish/Subscribe |
| **Latency** | Wait for response | Fire-and-forget |
| **Return values** | Structured responses | None |
| **Route params** | Full parameterized routes | Topics only |
| **Timeout handling** | Built-in timeouts | N/A |
| **Cancellation** | AbortSignal support | Manual unsubscribe |
| **Error model** | Structured error codes | Silently ignored |

---

## Documentation

- [API Reference](#api-reference)
- [docs/server-guide.md](./docs/server-guide.md) — Setting up AtBusServer
- [docs/client-guide.md](./docs/client-guide.md) — Making requests and handling errors
- [docs/routing.md](./docs/routing.md) — Route matching and parameters
- [docs/cancellation.md](./docs/cancellation.md) — Timeouts and AbortSignal
- [CHANGELOG.md](./CHANGELOG.md) — Version history

---

## Testing

```bash
deno test tests/
```

---

## License

MIT © 2026

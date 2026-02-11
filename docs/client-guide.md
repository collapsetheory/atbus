# AtBus Client Guide

A practical guide to making requests and handling responses with `AtBusClient`.

## Creating a Client

```ts
import { AtBusClient } from "@collapse-theory/atbus";

// Basic creation (auto-starts)
const client = new AtBusClient(port);

// With options
const client = new AtBusClient(port, {
  autoStart: false,           // Manual start
  timeoutMs: 5000,            // Default timeout for requests
  maxPayloadBytes: 1024 * 1024, // 1MB limit
  clientId: "my-client",      // Custom identifier
  targetId: "my-server",      // Target specific server
  bus: "api",                 // Bus name
});

// Manual start if autoStart is false
client.start();
```

## Making Requests

### Simple Request

```ts
const result = await client.call("/ping", null);
console.log(result);
```

### Typed Request and Response

```ts
interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  token: string;
  expiresAt: number;
}

const response = await client.call<LoginResponse, LoginRequest>(
  "/login",
  { username: "alice", password: "secret123" }
);

console.log(response.token);
console.log(response.expiresAt);
```

### Route Parameters

```ts
interface GetUserResponse {
  id: string;
  name: string;
  email: string;
}

const user = await client.call<GetUserResponse>("/users/123/profile", null);
// Server receives: route="/users/123/profile", params={userId: "123"}
```

### Passing Data

```ts
interface CreatePostRequest {
  title: string;
  content: string;
  tags: string[];
}

interface CreatePostResponse {
  id: string;
  created: boolean;
}

const result = await client.call<CreatePostResponse, CreatePostRequest>(
  "/posts",
  {
    title: "Getting Started with AtBus",
    content: "Learn the basics...",
    tags: ["tutorial", "atbus"],
  }
);
```

## Handling Timeouts

### Default Timeout

```ts
const client = new AtBusClient(port, {
  timeoutMs: 10000, // 10 second default for all requests
});

try {
  const result = await client.call("/operation", null);
} catch (error) {
  if (error instanceof AtBusRemoteError && error.code === "TIMEOUT") {
    console.error("Request timed out");
  }
}
```

### Per-Request Timeout

```ts
const client = new AtBusClient(port, { timeoutMs: 10000 });

// Fast operation with short timeout
const quick = await client.call("/quick", null, { timeoutMs: 1000 });

// Slow operation with longer timeout
const slow = await client.call("/slow", null, { timeoutMs: 30000 });
```

### Infinite Timeout

```ts
// Wait indefinitely (not recommended for production)
const result = await client.call("/operation", null, { timeoutMs: Infinity });
```

## Request Cancellation

### AbortController

Cancel a request using standard `AbortSignal`:

```ts
const controller = new AbortController();

// Start request
const promise = client.call("/long-op", payload, {
  signal: controller.signal,
});

// Cancel after 2 seconds
setTimeout(() => controller.abort(), 2000);

try {
  await promise;
} catch (error) {
  if (error instanceof AtBusRemoteError && error.code === "CANCELLED") {
    console.log("Request was cancelled");
  }
}
```

### Combining Timeout and Cancellation

```ts
const controller = new AbortController();

// Manual cancel after 5 seconds
const cancelTimer = setTimeout(() => controller.abort(), 5000);

try {
  const result = await client.call("/operation", payload, {
    timeoutMs: 10000, // Timeout: 10s
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    if (error.code === "CANCELLED") {
      console.log("Manually cancelled");
    } else if (error.code === "TIMEOUT") {
      console.log("Timed out");
    }
  }
} finally {
  clearTimeout(cancelTimer);
}
```

### Promise Race for Timeout

```ts
function callWithDeadline<T>(
  client: AtBusClient,
  route: string,
  payload: unknown,
  deadlineMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);

  return client.call<T>(route, payload, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

const result = await callWithDeadline("/operation", null, 5000);
```

## Error Handling

### Catching Remote Errors

```ts
import { AtBusClient, AtBusRemoteError, AtBusErrorCode } from "@collapse-theory/atbus";

try {
  const result = await client.call("/users/invalid-id", null);
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    console.log(error.code);      // "ROUTE_NOT_FOUND" etc
    console.log(error.message);   // Human-readable error
    console.log(error.route);     // Route that failed
    console.log(error.retriable); // Should retry?
    console.log(error.details);   // Optional extra data
  }
}
```

### Handling Specific Errors

```ts
try {
  await client.call("/operation", null);
} catch (error) {
  if (!(error instanceof AtBusRemoteError)) {
    throw error; // Unexpected error
  }

  switch (error.code) {
    case AtBusErrorCode.RouteNotFound:
      console.error("Route not registered");
      break;
    case AtBusErrorCode.Timeout:
      console.error("Request timed out");
      break;
    case AtBusErrorCode.Forbidden:
      console.error("Not allowed to access this route");
      break;
    case AtBusErrorCode.PayloadTooLarge:
      console.error("Payload exceeds size limit");
      break;
    case AtBusErrorCode.Cancelled:
      console.error("Request was cancelled");
      break;
    default:
      console.error(`Error: ${error.code}: ${error.message}`);
  }
}
```

### Retry Logic

```ts
async function callWithRetry<T>(
  client: AtBusClient,
  route: string,
  payload: unknown,
  maxRetries = 3,
  baseDelayMs = 100
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await client.call<T>(route, payload);
    } catch (error) {
      lastError = error;

      // Check if error is retriable
      if (!(error instanceof AtBusRemoteError) || !error.retriable) {
        throw error;
      }

      // Exponential backoff
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Usage
const result = await callWithRetry("/flaky-op", null);
```

### Handling Details

```ts
try {
  await client.call("/operation", null);
} catch (error) {
  if (error instanceof AtBusRemoteError && error.details) {
    console.error("Additional info:", error.details);
    // e.g., { validationErrors: [...], timestamp: "2024-01-01T..." }
  }
}
```

## Lifecycle Management

### Starting and Stopping

```ts
// Auto-start (default)
const client = new AtBusClient(port);

// Or manual control
const client = new AtBusClient(port, { autoStart: false });
client.start();

// Stop and reject pending requests
client.stop("Shutting down");
// or
client.close();

// After stop, operations throw
client.call("/route", null); // Throws: ClientClosed
```

### Safe Cleanup

```ts
function setupClient(port: MessagePort) {
  const client = new AtBusClient(port);
  
  return {
    call: (route: string, payload: unknown) =>
      client.call(route, payload),
    cleanup: () => {
      client.close();
    },
  };
}

const { call, cleanup } = setupClient(port);

// Later
cleanup();
```

## Addressing (BroadcastChannel)

### Targeting Specific Servers

```ts
// Target a specific server
const client = new AtBusClient(
  new BroadcastChannel("app-bus"),
  {
    clientId: "app",
    targetId: "database-server",
    bus: "core",
  }
);

const result = await client.call("/query", null);
// Request includes:
//   sourceId: "app"
//   targetId: "database-server"
//   bus: "core"
```

### Multiple Servers

```ts
const channel = new BroadcastChannel("app-bus");

// Client for auth service
const authClient = new AtBusClient(channel, {
  clientId: "app",
  targetId: "auth-server",
  bus: "core",
});

// Client for database service
const dbClient = new AtBusClient(channel, {
  clientId: "app",
  targetId: "database-server",
  bus: "core",
});

const token = await authClient.call("/login", { user: "alice" });
const data = await dbClient.call("/query", { sql: "SELECT..." });
```

## Common Patterns

### Sequential Requests

```ts
async function workflow() {
  const loginResp = await client.call("/login", { user: "alice" });
  const userResp = await client.call("/user/profile", { token: loginResp.token });
  const postsResp = await client.call("/user/posts", { userId: userResp.id });
  return postsResp;
}

const posts = await workflow();
```

### Parallel Requests

```ts
async function getMultipleData() {
  const [users, posts, comments] = await Promise.all([
    client.call("/users", null),
    client.call("/posts", null),
    client.call("/comments", null),
  ]);
  return { users, posts, comments };
}

const data = await getMultipleData();
```

### Request Batching

```ts
async function batchRequests(ids: string[]) {
  const results = await Promise.all(
    ids.map(id => client.call(`/items/${id}`, null).catch(e => ({ error: e })))
  );
  return results;
}

const items = await batchRequests(["1", "2", "3"]);
```

### Cache with Fallback

```ts
const cache = new Map<string, unknown>();

async function getCachedOrFetch<T>(route: string, payload: unknown): Promise<T> {
  const cacheKey = `${route}:${JSON.stringify(payload)}`;

  // Return from cache
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) as T;
  }

  // Fetch from server
  const result = await client.call<T>(route, payload);

  // Store in cache
  cache.set(cacheKey, result);

  return result;
}

const user = await getCachedOrFetch("/user/profile", { id: "123" });
```

### Progress Tracking

```ts
async function processWithProgress(items: string[]) {
  const results = [];
  let completed = 0;

  for (const item of items) {
    const result = await client.call("/process", { item });
    results.push(result);
    completed++;
    console.log(`Progress: ${completed}/${items.length}`);
  }

  return results;
}
```

## Error Codes Reference

- `ROUTE_NOT_FOUND` - No handler registered
- `TIMEOUT` - Request exceeded timeout (retriable)
- `CANCELLED` - AbortSignal fired
- `INTERNAL_ERROR` - Handler threw unhandled error
- `INVALID_MESSAGE` - Malformed request
- `PAYLOAD_TOO_LARGE` - Data exceeds limit
- `FORBIDDEN` - Server rejected route via `canHandle`
- `CLIENT_CLOSED` - Client stopped before response
- `TRANSPORT_ERROR` - Port/channel communication failed (retriable)

## Best Practices

1. **Always type your requests and responses** - Better IDE support and type safety
2. **Set appropriate timeouts** - Balance responsiveness with real handler duration
3. **Use AbortSignal for long operations** - Give users control to cancel
4. **Implement retry logic for retriable errors** - Network is unreliable
5. **Log error details** - Helps with debugging
6. **Clean up properly** - Call `close()` when done
7. **Use explicit targetId when needed** - Makes routing clear with BroadcastChannel
8. **Handle errors gracefully** - Don't let unhandled errors crash your app

## See Also

- [AtBusServer Guide](./server-guide.md)
- [Routing Guide](./routing.md)
- [Cancellation Guide](./cancellation.md)
- [Main README](../README.md)
- [PushBus Client Guide](../../pushbus/docs/client-guide.md)

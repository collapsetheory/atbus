# AtBus Server Guide

A practical guide to setting up and configuring `AtBusServer` with route handlers.

## Creating a Server

```ts
import { AtBusServer } from "@collapse-theory/atbus";

// Basic setup (auto-starts)
const server = new AtBusServer(port);

// With options
const server = new AtBusServer(port, {
  autoStart: false,           // Manual start
  timeoutMs: 30000,           // Default handler timeout (informational)
  maxPayloadBytes: 2 * 1024 * 1024, // 2MB limit
  serverId: "my-server",      // Custom identifier
  bus: "api",                 // Bus name for isolation
  acceptUnaddressed: true,    // Accept unaddressed messages
  canHandle: (route) => true, // Custom route filter
});

// Manual start if autoStart is false
server.start();
```

## Registering Routes

### Simple Route

```ts
server.at("/hello", () => {
  return { message: "hello" };
});

// Client
const result = await client.call("/hello", null);
console.log(result.message); // "hello"
```

### Typed Handlers

```ts
interface GreetRequest {
  name: string;
}

interface GreetResponse {
  greeting: string;
}

server.at<GreetRequest, GreetResponse>(
  "/greet",
  (payload) => {
    return { greeting: `Hello, ${payload.name}!` };
  }
);

// Client
const response = await client.call<GreetResponse, GreetRequest>(
  "/greet",
  { name: "Alice" }
);
console.log(response.greeting); // "Hello, Alice!"
```

### Async Handlers

```ts
server.at("/fetch-user", async (payload) => {
  const userId = payload.id as string;
  const user = await database.getUser(userId);
  return user;
});
```

### Handler Context

Access route info, parameters, and cancellation signal:

```ts
server.at<any, any>(
  "/users/:userId",
  (payload, ctx) => {
    console.log(ctx.route);        // "/users/123"
    console.log(ctx.matchedRoute); // "/users/:userId"
    console.log(ctx.params);       // { userId: "123" }
    console.log(ctx.signal);       // AbortSignal
    
    return { userId: ctx.params.userId };
  }
);
```

## Route Types

### Exact Routes

```ts
server.at("/status", () => ({ ok: true }));
server.at("/admin/reset", () => ({ reset: true }));
```

### Parameterized Routes

```ts
server.at("/users/:userId", (_, ctx) => ({
  userId: ctx.params.userId,
}));

server.at("/posts/:postId/comments/:commentId", (_, ctx) => ({
  postId: ctx.params.postId,
  commentId: ctx.params.commentId,
}));
```

### Regex Routes

```ts
server.at(/^\/api\/v\d+\/.*$/, () => ({ version: "matched" }));

server.at(/^\/admin\/.*/, (_, ctx) => ({
  adminPath: ctx.route,
}));
```

See [Routing Guide](./routing.md) for detailed route matching.

## Server Lifecycle

### Starting

```ts
// Auto-start (default)
const server = new AtBusServer(port);

// Or manual control
const server = new AtBusServer(port, { autoStart: false });
server.start();
```

### Stopping

```ts
// Graceful shutdown
server.stop("Shutting down");

// Or just close
server.close();

// After stop:
// - In-flight handlers are aborted
// - New requests are rejected
```

### Graceful Shutdown Example

```ts
const server = new AtBusServer(port);

server.at("/process", async (payload, ctx) => {
  // Handle cancellation
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ done: true }), 5000);
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("interrupted"));
    });
  });
});

// Shutdown handler
async function shutdown() {
  console.log("Shutting down server...");
  server.close();
  console.log("Server closed, all handlers aborted");
}

process.on("SIGTERM", shutdown);
```

## Route Filtering

### Restrict Allowed Routes

Use `canHandle` to limit which routes this server processes:

```ts
// Only handle /api/* routes
const server = new AtBusServer(port, {
  canHandle: (route) => route.startsWith("/api/"),
});

// ✓ Accepts: /api/users, /api/data
// ✗ Rejects: /admin/users, /public/info
```

### Complex Filtering

```ts
const server = new AtBusServer(port, {
  canHandle: (route) => {
    // Handle public API routes
    if (route.startsWith("/api/public/")) return true;
    
    // Handle internal routes
    if (route.startsWith("/internal/")) return true;
    
    // Reject everything else
    return false;
  },
});
```

### Server Sharding

Split routes across multiple servers:

```ts
// User service
const userServer = new AtBusServer(portA, {
  serverId: "user-service",
  canHandle: (route) => route.startsWith("/users/"),
});

userServer.at("/users/:id", (_, ctx) => ({
  id: ctx.params.id,
  name: "Alice",
}));

// Post service
const postServer = new AtBusServer(portB, {
  serverId: "post-service",
  canHandle: (route) => route.startsWith("/posts/"),
});

postServer.at("/posts/:id", (_, ctx) => ({
  id: ctx.params.id,
  title: "Hello World",
}));
```

## Error Handling

### Handler Errors

```ts
server.at("/divide", (payload) => {
  if (payload.divisor === 0) {
    throw new Error("Cannot divide by zero");
  }
  return { result: payload.dividend / payload.divisor };
});

// Client
try {
  await client.call("/divide", { dividend: 10, divisor: 0 });
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    console.log(error.code);    // "INTERNAL_ERROR"
    console.log(error.message); // "Cannot divide by zero"
  }
}
```

### Structured Errors

```ts
class ValidationError extends Error {
  code = "VALIDATION_ERROR";
  
  constructor(
    message: string,
    public details: Record<string, unknown>
  ) {
    super(message);
  }
}

server.at("/create-user", (payload) => {
  if (!payload.email) {
    throw new ValidationError("Email required", {
      field: "email",
      error: "required",
    });
  }
  return { id: "user-123", created: true };
});

// Client
try {
  await client.call("/create-user", { name: "Alice" });
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    console.log(error.code);     // "VALIDATION_ERROR"
    console.log(error.details);  // { field: "email", error: "required" }
  }
}
```

### Not-Found Errors

```ts
server.at("/user/:id", (_, ctx) => {
  const user = findUserById(ctx.params.id);
  if (!user) {
    const error = new Error(`User ${ctx.params.id} not found`);
    (error as any).code = "NOT_FOUND";
    throw error;
  }
  return user;
});

// Client
try {
  await client.call("/user/nonexistent", null);
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    console.log(error.code);    // "NOT_FOUND" or "INTERNAL_ERROR"
    console.log(error.message); // "User nonexistent not found"
  }
}
```

## Payload Limits

### Enforce Maximum Payload Size

```ts
const server = new AtBusServer(port, {
  maxPayloadBytes: 1024 * 1024, // 1MB max
});

// If client sends > 1MB:
// Server rejects with PAYLOAD_TOO_LARGE error
```

### Check Payload Size

```ts
import { payloadSizeBytes } from "@collapse-theory/atbus";

server.at("/upload", (payload) => {
  const bytes = payloadSizeBytes(payload);
  if (bytes > 10_000_000) {
    throw new Error("Payload too large");
  }
  // Process payload
  return { ok: true };
});
```

## Addressing (BroadcastChannel)

### Static Server ID

```ts
const server = new AtBusServer(channel, {
  serverId: "main-server",
  bus: "core",
  acceptUnaddressed: false,
});

// Clients must target this server
const client = new AtBusClient(channel, {
  clientId: "client",
  targetId: "main-server",
  bus: "core",
});

const result = await client.call("/operation", null);
```

### Multiple Servers

```ts
const channel = new BroadcastChannel("app-bus");

// Server A
const serverA = new AtBusServer(channel, {
  serverId: "server-a",
  bus: "core",
  acceptUnaddressed: false,
});

serverA.at("/a-service", () => ({ server: "A" }));

// Server B
const serverB = new AtBusServer(channel, {
  serverId: "server-b",
  bus: "core",
  acceptUnaddressed: false,
});

serverB.at("/b-service", () => ({ server: "B" }));

// Clients target specific servers
const clientA = new AtBusClient(channel, {
  targetId: "server-a",
  bus: "core",
});

const clientB = new AtBusClient(channel, {
  targetId: "server-b",
  bus: "core",
});

const a = await clientA.call("/a-service", null);
const b = await clientB.call("/b-service", null);
```

## Bus Isolation

### Separate Concerns

```ts
const channel = new BroadcastChannel("app-bus");

// API server
const apiServer = new AtBusServer(channel, {
  serverId: "api",
  bus: "api",
  acceptUnaddressed: false,
});

apiServer.at("/users", () => ({...}));

// Analytics server
const analyticsServer = new AtBusServer(channel, {
  serverId: "analytics",
  bus: "analytics",
  acceptUnaddressed: false,
});

analyticsServer.at("/track", () => ({...}));

// Separate clients
const apiClient = new AtBusClient(channel, {
  targetId: "api",
  bus: "api",
});

const analyticsClient = new AtBusClient(channel, {
  targetId: "analytics",
  bus: "analytics",
});

// Messages don't cross bus boundaries
```

## Common Patterns

### CRUD Operations

```ts
const db = new Map<string, any>();

server.at("/items", () => {
  return Array.from(db.values());
});

server.at("/items", (payload) => {
  const id = crypto.randomUUID();
  db.set(id, payload);
  return { id, ...payload };
});

server.at("/items/:id", (_, ctx) => {
  return db.get(ctx.params.id) || null;
});

server.at("/items/:id", (payload, ctx) => {
  const id = ctx.params.id;
  if (!db.has(id)) throw new Error("Not found");
  db.set(id, payload);
  return { id, ...payload };
});

server.at("/items/:id", (_, ctx) => {
  const id = ctx.params.id;
  const existed = db.has(id);
  db.delete(id);
  return { deleted: existed };
});
```

### Middleware Pattern

```ts
function authenticate<TIn, TOut>(
  handler: AtBusHandler<TIn, TOut>
): AtBusHandler<TIn, TOut> {
  return async (payload, ctx) => {
    if (!isAuthenticated(ctx)) {
      throw new Error("Not authenticated");
    }
    return handler(payload, ctx);
  };
}

function authorize<TIn, TOut>(
  handler: AtBusHandler<TIn, TOut>,
  requiredRole: string
): AtBusHandler<TIn, TOut> {
  return async (payload, ctx) => {
    if (!hasRole(ctx, requiredRole)) {
      throw new Error("Insufficient permissions");
    }
    return handler(payload, ctx);
  };
}

// Usage
server.at(
  "/admin/reset",
  authenticate(
    authorize(
      async () => ({ reset: true }),
      "admin"
    )
  )
);
```

### Caching

```ts
const cache = new Map<string, any>();
const cacheExpiry = new Map<string, number>();

server.at("/user/:id", (_, ctx) => {
  const cacheKey = `user:${ctx.params.id}`;
  
  // Check cache
  if (cache.has(cacheKey)) {
    const expiry = cacheExpiry.get(cacheKey);
    if (expiry && Date.now() < expiry) {
      return cache.get(cacheKey);
    }
    cache.delete(cacheKey);
  }

  // Fetch from database
  const user = database.getUser(ctx.params.id);
  
  // Store in cache (1 hour expiry)
  cache.set(cacheKey, user);
  cacheExpiry.set(cacheKey, Date.now() + 3600000);
  
  return user;
});
```

### Rate Limiting

```ts
const requestCounts = new Map<string, number[]>();

function getRateLimit(clientId: string): number {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  
  let counts = requestCounts.get(clientId) || [];
  counts = counts.filter(time => time > oneMinuteAgo);
  requestCounts.set(clientId, counts);
  
  return counts.length;
}

server.at("/rate-limited", (_, ctx) => {
  const clientId = ctx.route.split(":")[0] || "unknown";
  const count = getRateLimit(clientId);
  
  if (count > 100) { // 100 requests per minute
    throw new Error("Rate limit exceeded");
  }
  
  requestCounts.get(clientId)!.push(Date.now());
  return { ok: true };
});
```

## Best Practices

1. **Set explicit `serverId`** - Makes debugging and addressing easier
2. **Use `canHandle` strategically** - Limits what the server handles
3. **Type your handlers** - Better IDE support and type safety
4. **Handle errors explicitly** - Return meaningful error information
5. **Check `ctx.signal` in long handlers** - Allow cancellation
6. **Clean up resources** - Close files, connections, etc.
7. **Set appropriate payload limits** - Balance security with use case
8. **Use `acceptUnaddressed: false` with BroadcastChannel** - Prevents unintended routing
9. **Log important events** - Helps with debugging and monitoring
10. **Test error paths** - Ensure proper error handling

## See Also

- [AtBus Client Guide](./client-guide.md)
- [Routing Guide](./routing.md)
- [Cancellation Guide](./cancellation.md)
- [Main README](../README.md)
- [PushBus Server Guide](../../pushbus/docs/server-guide.md)

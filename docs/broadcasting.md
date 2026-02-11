# AtBus Broadcasting Guide

Guide to using AtBus with `BroadcastChannel` and targeting specific servers with requests.

## Why BroadcastChannel?

`MessagePort` is direct 1:1 communication between two contexts. `BroadcastChannel` is broadcast-based: all listeners on the same channel receive the same messages.

**BroadcastChannel use cases:**
- Multiple worker instances all handling requests
- You want load balancing across servers
- You need to add/remove servers dynamically
- Tab/Window coordination

## Basic BroadcastChannel Setup

### Without Addressing

All servers receive all requests:

```ts
import { AtBusClient, AtBusServer } from "@collapse-theory/atbus";

const channelName = "my-app";
const channel = new BroadcastChannel(channelName);

// Multiple servers
const server1 = new AtBusServer(channel, {
  serverId: "server-1",
});

const server2 = new AtBusServer(channel, {
  serverId: "server-2",
});

// Multiple clients
const client1 = new AtBusClient(channel, {
  clientId: "client-1",
});

const client2 = new AtBusClient(channel, {
  clientId: "client-2",
});

// Problem: All requests go to all servers (race condition)
// First server to respond wins
const result = await client1.call("/operation", null);
// Could be handled by server-1 OR server-2
```

### With Targeting

Use `targetId` and `bus` to route requests precisely:

```ts
const channel = new BroadcastChannel("my-app");

// Servers only accept targeted requests
const serverA = new AtBusServer(channel, {
  serverId: "server-a",
  bus: "core",
  acceptUnaddressed: false, // IMPORTANT
});

const serverB = new AtBusServer(channel, {
  serverId: "server-b",
  bus: "core",
  acceptUnaddressed: false,
});

// Client A targets server A
const clientA = new AtBusClient(channel, {
  clientId: "client-a",
  targetId: "server-a",
  bus: "core",
});

// Client B targets server B
const clientB = new AtBusClient(channel, {
  clientId: "client-b",
  targetId: "server-b",
  bus: "core",
});

// clientA's requests ONLY go to server-a
// clientB's requests ONLY go to server-b
const resultA = await clientA.call("/operation", null);
const resultB = await clientB.call("/operation", null);
```

## Addressing Concepts

Three optional addressing fields:

### `sourceId`

The requester's identifier, automatically set on request:

```ts
const client = new AtBusClient(channel, {
  clientId: "mobile-app",  // This becomes sourceId
  // ...
});

await client.call("/operation", null);
// Request includes sourceId: "mobile-app"

// Server receives in handler context
server.at("/operation", (payload, ctx) => {
  // ctx includes sourceId from addressing
  return { ok: true };
});
```

### `targetId`

Specify which server should handle the request:

```ts
const client = new AtBusClient(channel, {
  clientId: "app",
  targetId: "database-server", // Only database-server handles
  bus: "core",
});

await client.call("/query", { sql: "SELECT..." });

// Only servers with:
//   serverId: "database-server"
//   bus: "core"
//   acceptUnaddressed: false (or true)
// Will process this request
```

### `bus`

Isolate groups of clients and servers:

```ts
// API service
const apiServer = new AtBusServer(channel, {
  serverId: "api",
  bus: "api", // Different bus
});

const apiClient = new AtBusClient(channel, {
  clientId: "app",
  targetId: "api",
  bus: "api", // Must match
});

// Database service
const dbServer = new AtBusServer(channel, {
  serverId: "database",
  bus: "database", // Different bus
});

const dbClient = new AtBusClient(channel, {
  clientId: "app",
  targetId: "database",
  bus: "database", // Must match
});

// Requests to API don't reach database server
await apiClient.call("/users", null);
```

## Addressing Rules

### Server-Side Filtering

A server accepts a request if ALL of these match:

1. **sourceId check**: Request sourceId must NOT equal server's serverId
   ```ts
   // Prevents a server from receiving its own requests
   ```

2. **targetId check**: If request has targetId, it must equal server's serverId
   ```ts
   // If targetId is set, MUST match
   // If targetId is unset and acceptUnaddressed: false, request rejected
   ```

3. **bus check**: If both request and server have bus, they must match
   ```ts
   // If server has bus: "api" and request has bus: "database"
   // Request rejected
   ```

### Example: Matching Rules

```ts
const server = new AtBusServer(channel, {
  serverId: "server-a",
  bus: "core",
  acceptUnaddressed: false,
});

// Request 1: Targeted to this server, same bus
const msg1 = {
  sourceId: "client-1",
  targetId: "server-a",
  bus: "core",
};
// ✓ ACCEPTED

// Request 2: Targeted to different server
const msg2 = {
  sourceId: "client-1",
  targetId: "server-b",
  bus: "core",
};
// ✗ REJECTED (targetId mismatch)

// Request 3: No target, no bus
const msg3 = {
  sourceId: "client-1",
};
// ✗ REJECTED (acceptUnaddressed: false, no targetId)

// Request 4: Different bus
const msg4 = {
  sourceId: "client-1",
  targetId: "server-a",
  bus: "analytics",
};
// ✗ REJECTED (bus mismatch)

// Request 5: No bus specified
const msg5 = {
  sourceId: "client-1",
  targetId: "server-a",
  // No bus
};
// ✓ ACCEPTED (request bus unset, so no check)
```

## Setting Up Multi-Server System

### Pattern: Service-Based Sharding

Each service has its own server(s) and bus:

```ts
const channel = new BroadcastChannel("app-bus");

// User service
const userServer = new AtBusServer(channel, {
  serverId: "user-service",
  bus: "users",
  acceptUnaddressed: false,
});

userServer.at("/users/:id", (_, ctx) => ({
  id: ctx.params.id,
  name: "Alice",
}));

// Post service
const postServer = new AtBusServer(channel, {
  serverId: "post-service",
  bus: "posts",
  acceptUnaddressed: false,
});

postServer.at("/posts/:id", (_, ctx) => ({
  id: ctx.params.id,
  title: "Hello World",
}));

// Client routes to each service
const userClient = new AtBusClient(channel, {
  clientId: "app",
  targetId: "user-service",
  bus: "users",
});

const postClient = new AtBusClient(channel, {
  clientId: "app",
  targetId: "post-service",
  bus: "posts",
});

const user = await userClient.call("/users/123", null);
const post = await postClient.call("/posts/456", null);
```

### Pattern: Server Redundancy

Multiple servers handle the same requests:

```ts
const channel = new BroadcastChannel("api");

// Primary server
const primaryServer = new AtBusServer(channel, {
  serverId: "api-primary",
  bus: "api",
  acceptUnaddressed: false,
});

primaryServer.at("/operation", async () => {
  return { result: "from primary" };
});

// Backup server
const backupServer = new AtBusServer(channel, {
  serverId: "api-backup",
  bus: "api",
  acceptUnaddressed: false,
});

backupServer.at("/operation", async () => {
  return { result: "from backup" };
});

// Client tries primary, falls back to backup
const primaryClient = new AtBusClient(channel, {
  clientId: "client",
  targetId: "api-primary",
  bus: "api",
});

let result;
try {
  result = await primaryClient.call("/operation", null);
} catch (error) {
  // Fall back to backup
  const backupClient = new AtBusClient(channel, {
    clientId: "client",
    targetId: "api-backup",
    bus: "api",
  });
  result = await backupClient.call("/operation", null);
}
```

### Pattern: Load Balancing

Distribute requests across multiple servers:

```ts
const channel = new BroadcastChannel("workers");
const serverCount = 3;

// Create multiple worker servers
const servers = Array.from({ length: serverCount }, (_, i) => {
  return new AtBusServer(channel, {
    serverId: `worker-${i}`,
    bus: "workers",
    acceptUnaddressed: false,
  });
});

servers.forEach((server, i) => {
  server.at("/job", async (payload) => {
    console.log(`Worker ${i} processing job`);
    return { workerId: i, result: "done" };
  });
});

// Load balancer
class LoadBalancer {
  #nextServer = 0;

  async call<T>(route: string, payload: unknown): Promise<T> {
    const serverId = `worker-${this.#nextServer % serverCount}`;
    this.#nextServer++;

    const client = new AtBusClient(channel, {
      clientId: "load-balancer",
      targetId: serverId,
      bus: "workers",
    });

    return client.call<T>(route, payload);
  }
}

// Usage
const balancer = new LoadBalancer();
const result1 = await balancer.call("/job", { task: "a" });
const result2 = await balancer.call("/job", { task: "b" });
const result3 = await balancer.call("/job", { task: "c" });
// Distributed across workers
```

## Common Pitfalls

### Forgetting `acceptUnaddressed: false`

```ts
// ✗ WRONG: Server accepts all requests
const server = new AtBusServer(channel, {
  serverId: "server-a",
  bus: "core",
  // acceptUnaddressed defaults to true
});

// Requests without targetId still reach all servers
// Race condition: multiple servers respond
// Only first response is used, others timeout

// ✓ RIGHT: Only targeted requests
const server = new AtBusServer(channel, {
  serverId: "server-a",
  bus: "core",
  acceptUnaddressed: false, // Explicit
});

// Only requests with targetId: "server-a" are processed
```

### Bus Name Mismatches

```ts
// ✗ WRONG: Bus names don't match
const server = new AtBusServer(channel, {
  serverId: "api",
  bus: "myapp",
});

const client = new AtBusClient(channel, {
  clientId: "app",
  targetId: "api",
  bus: "my-app", // Typo: underscore in different place
});

// Client requests never reach server
// Client gets TIMEOUT error

// ✓ RIGHT: Same bus name
const server = new AtBusServer(channel, {
  serverId: "api",
  bus: "myapp",
});

const client = new AtBusClient(channel, {
  clientId: "app",
  targetId: "api",
  bus: "myapp", // Exact match
});
```

### Self-Targeting

```ts
// ✗ WRONG: Server targets itself
const server = new AtBusServer(channel, {
  serverId: "server-a",
  targetId: "server-a", // Don't do this
  bus: "core",
});

// Server ignores its own requests (by design)

// ✓ RIGHT: Messages are always from client to server
const client = new AtBusClient(channel, {
  clientId: "client-1",
  targetId: "server-a",
  bus: "core",
});

await client.call("/operation", null); // This reaches server-a
```

## Debugging Tips

### Log Routing Information

```ts
server.at(/.*/, (payload, ctx) => {
  console.log(`Request: ${ctx.route} matched ${ctx.matchedRoute}`);
  // Route details help identify which requests reach this server
});
```

### Use Descriptive IDs

```ts
// Bad: Hard to understand
const server = new AtBusServer(channel, {
  serverId: crypto.randomUUID(),
  bus: "b1",
});

// Good: Clear in logs
const server = new AtBusServer(channel, {
  serverId: "user-api-primary",
  bus: "user-api",
});

const client = new AtBusClient(channel, {
  clientId: "mobile-app",
  targetId: "user-api-primary",
  bus: "user-api",
});
```

### Channel Name Convention

```ts
// Use descriptive channel names
const channel = new BroadcastChannel("app-v1-services");
// Better than just "bus" or "channel"
```

### Test Route Routing

```ts
server.at("/debug/routing", (_, ctx) => {
  return {
    serverId: ctx.route, // Echo back for testing
    matchedRoute: ctx.matchedRoute,
  };
});

// Client can verify it reaches correct server
const result = await client.call("/debug/routing", null);
console.log("Reached server:", result.serverId);
```

## Comparison: MessagePort vs BroadcastChannel

| Aspect | MessagePort | BroadcastChannel |
|--------|------------|------------------|
| **1:1 communication** | Yes | No (broadcast) |
| **Many servers** | N/A | Requires addressing |
| **Load balancing** | N/A | With round-robin |
| **Addressing** | Not needed | Required for routing |
| **Isolation** | Built-in | Via bus names |
| **Complexity** | Simple | More setup needed |

## See Also

- [Client Guide](./client-guide.md)
- [Server Guide](./server-guide.md)
- [Routing Guide](./routing.md)
- [Main README](../README.md)
- [PushBus Broadcasting](../../pushbus/docs/broadcasting.md)

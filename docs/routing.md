# AtBus Routing Guide

Deep dive into route matching, parameters, and regex patterns in AtBus.

## Route Basics

### Route Format

Routes are strings starting with `/`:

```ts
"/hello"              // Simple route
"/users/list"         // Hierarchical
"/users/:id"          // With parameter
"/posts/:id/comments/:commentId"  // Multiple parameters
```

Routes can also be regex patterns:

```ts
/^\/api\/v\d+\/.*$/   // Regex pattern
```

## Exact Routes

Simple string matching:

```ts
// Server
server.at("/hello", () => ({ message: "hello" }));

// Client must call exactly "/hello"
await client.call("/hello", null);  // ✓ Matches
await client.call("/hello/world", null);  // ✗ No match
await client.call("/hel", null);  // ✗ No match
```

## Parameterized Routes

Extract variables from the route:

### Single Parameter

```ts
// Server
server.at("/users/:userId", (_, ctx) => {
  const userId = ctx.params.userId;
  return { userId, name: "Alice" };
});

// Client
await client.call("/users/123", null);
// Server receives:
//   route: "/users/123"
//   matchedRoute: "/users/:userId"
//   params: { userId: "123" }
```

### Multiple Parameters

```ts
// Server
server.at(
  "/posts/:postId/comments/:commentId",
  (_, ctx) => {
    const { postId, commentId } = ctx.params;
    return { postId, commentId, text: "Great post!" };
  }
);

// Client
await client.call("/posts/42/comments/7", null);
// Server receives:
//   params: { postId: "42", commentId: "7" }
```

### Parameter Names

Parameter names:
- Start with `:`
- Consist of alphanumeric characters and underscores
- Are case-sensitive

```ts
server.at("/users/:userId/posts/:post_id", (_, ctx) => {
  // params: { userId: "...", post_id: "..." }
});
```

### Parameter Extraction

Parameters are always strings:

```ts
server.at("/items/:itemId", (_, ctx) => {
  const itemId = ctx.params.itemId; // Always a string
  const numId = parseInt(itemId);   // Convert if needed
  return { itemId, numId };
});
```

## Regex Routes

Match complex patterns:

### Basic Regex

```ts
// Server
server.at(/^\/api\/v\d+\/users$/, () => ({...}));

// Client can call
await client.call("/api/v1/users", null);    // ✓ Matches
await client.call("/api/v2/users", null);    // ✓ Matches
await client.call("/api/v10/users", null);   // ✓ Matches
await client.call("/api/latest/users", null); // ✗ No match
```

### Regex with Wildcards

```ts
// Match anything under /admin
server.at(/^\/admin\/.*/, () => ({ ok: true }));

// Matches:
await client.call("/admin/users", null);           // ✓
await client.call("/admin/settings/theme", null);  // ✓
await client.call("/admin", null);                 // ✗ (needs trailing part)
```

### Complex Patterns

```ts
// UUIDs
server.at(
  /^\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  () => ({...})
);

// Slugs
server.at(/^\/posts\/[a-z0-9-]+$/, () => ({...}));

// API versions
server.at(/^\/api\/(v|version)\d+\/.*/, () => ({...}));
```

### Limitations of Regex

Regex routes:
- Don't extract parameters (unlike `:id` syntax)
- Must match the entire route
- Are checked after exact and parameterized routes

```ts
// ✓ Works: Entire route matches
server.at(/^\/api\/v\d+\/users$/, () => ({...}));

// ✗ Doesn't work: Only matches prefix
server.at(/^\/api\/v\d+/, () => ({...})); // Missing $ at end

// Won't extract: Regex doesn't support parameter extraction
server.at(/^\/users\/(\d+)$/, (_, ctx) => {
  // ctx.params is empty
  // Can't get the matched group
});
```

## Route Matching Order

When multiple routes could match, servers try them in registration order:

```ts
server.at("/users/me", (_, ctx) => {
  return { user: "current" }; // Specific route
});

server.at("/users/:id", (_, ctx) => {
  return { user: ctx.params.id }; // Generic route
});

await client.call("/users/me", null);
// Matches "/users/me" first (more specific)
// Returns { user: "current" }

await client.call("/users/123", null);
// Doesn't match "/users/me"
// Falls through to "/users/:id"
// Returns { user: "123" }
```

This is why you should register more specific routes first.

## Handler Context Details

What a handler receives:

```ts
server.at("/users/:userId/posts/:postId", (payload, ctx) => {
  return {
    route: ctx.route,           // "/users/42/posts/7"
    matchedRoute: ctx.matchedRoute, // "/users/:userId/posts/:postId"
    params: ctx.params,         // { userId: "42", postId: "7" }
    signal: ctx.signal,         // AbortSignal
  };
});
```

### `route`
The exact route the client called:
```ts
// Client: client.call("/users/123/posts/456", null)
// Handler: ctx.route === "/users/123/posts/456"
```

### `matchedRoute`
The handler's route pattern (for debugging):
```ts
// Handler registered: server.at("/users/:userId/posts/:postId", ...)
// Handler: ctx.matchedRoute === "/users/:userId/posts/:postId"

// Or for regex:
// Handler registered: server.at(/^\/api\/v\d+\/.*$/, ...)
// Handler: ctx.matchedRoute === "/^\/api\/v\d+\/.*$/"
```

### `params`
Extracted parameters (only for parameterized routes):
```ts
// Parameterized route
server.at("/users/:userId", (_, ctx) => {
  console.log(ctx.params); // { userId: "123" }
});

// Regex route
server.at(/^\/users\/\d+$/, (_, ctx) => {
  console.log(ctx.params); // {} (empty)
});
```

### `signal`
AbortSignal for cancellation handling:
```ts
server.at("/long-op", async (_, ctx) => {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(resolve, 30000);
    
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
});
```

## Route Validation

Routes are validated when registering:

```ts
// ✓ Valid
server.at("/hello", ...);
server.at("/users/:id", ...);
server.at("/posts/:postId/comments/:id", ...);

// ✗ Invalid (must start with /)
server.at("hello", ...);  // Error!

// Regex routes are always valid
server.at(/.*/, ...);  // OK
```

## Common Patterns

### RESTful API

```ts
// GET /items
server.at("/items", () => ({...}));

// GET /items/:id
server.at("/items/:id", (_, ctx) => ({
  id: ctx.params.id,
}));

// POST /items (payload is the item data)
server.at("/items/create", (payload: any) => ({
  created: true,
  id: generateId(),
}));

// PUT /items/:id
server.at("/items/:id/update", (payload, ctx) => ({
  id: ctx.params.id,
  updated: true,
}));

// DELETE /items/:id
server.at("/items/:id/delete", (_, ctx) => ({
  id: ctx.params.id,
  deleted: true,
}));
```

### Nested Resources

```ts
// Get user's posts
server.at("/users/:userId/posts", (_, ctx) => {
  const userId = ctx.params.userId;
  return { posts: [...] };
});

// Get specific post for user
server.at("/users/:userId/posts/:postId", (_, ctx) => {
  const { userId, postId } = ctx.params;
  return { post: {...} };
});

// Get comments on post
server.at(
  "/users/:userId/posts/:postId/comments",
  (_, ctx) => {
    const { userId, postId } = ctx.params;
    return { comments: [...] };
  }
);
```

### Search and Filter

```ts
// Search by slug
server.at("/search/:query", (_, ctx) => {
  const query = ctx.params.query;
  return { results: [...] };
});

// Search by ID (integer)
server.at(/^\/search\/\d+$/, (_, ctx) => {
  // Exact digits
  return { result: {...} };
});

// Search by UUID
server.at(
  /^\/search\/[0-9a-f-]{36}$/,
  (_, ctx) => {
    return { result: {...} };
  }
);
```

### Versioned APIs

```ts
// v1 endpoints
server.at("/v1/users", () => ({...}));
server.at("/v1/users/:id", (_, ctx) => ({...}));

// v2 endpoints (improved)
server.at("/v2/users", () => ({...}));
server.at("/v2/users/:id", (_, ctx) => ({...}));

// Or with regex
server.at(/^\/v\d+\/users$/, () => ({...}));
server.at(/^\/v\d+\/users\/\d+$/, () => ({...}));
```

### Admin Routes

```ts
// Protected admin routes
const adminRoutes = [
  "/admin/users",
  "/admin/settings",
  "/admin/reports/:reportId",
];

for (const route of adminRoutes) {
  server.at(route, async (payload, ctx) => {
    // All admin handlers can check ctx.route
    if (!isAdmin()) throw new Error("Not authorized");
    return {...};
  });
}
```

## Special Characters in Parameters

Parameters can contain most URL-safe characters:

```ts
server.at("/files/:path", (_, ctx) => {
  const filePath = ctx.params.path;
  return { filePath };
});

// Client can call with encoded paths
await client.call("/files/documents%2Fsubfolder%2Ffile.txt", null);
// Server receives: ctx.params.path === "documents%2Fsubfolder%2Ffile.txt"
```

Note: Parameters are NOT automatically URL-decoded. If needed, decode in your handler:

```ts
server.at("/files/:path", (_, ctx) => {
  const decodedPath = decodeURIComponent(ctx.params.path);
  return { path: decodedPath };
});
```

## Debugging Routes

### Log Matched Routes

```ts
server.at(/.*/, (payload, ctx) => {
  console.log(`${ctx.route} matched ${ctx.matchedRoute}`);
  console.log(`Params:`, ctx.params);
});
```

### Inspect Handler Parameters

```ts
server.at("/debug/:param1/:param2", (payload, ctx) => {
  return {
    route: ctx.route,
    matchedRoute: ctx.matchedRoute,
    params: ctx.params,
    payload,
  };
});
```

## See Also

- [AtBus Client Guide](./client-guide.md)
- [AtBus Server Guide](./server-guide.md)
- [Cancellation Guide](./cancellation.md)
- [Main README](../README.md)

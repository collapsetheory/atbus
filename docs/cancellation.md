# AtBus Cancellation and Timeouts Guide

Learn how to handle request timeouts, cancellation, and handler cleanup in AtBus.

## Overview

AtBus provides three mechanisms for managing long-running requests:
1. **Timeouts** - Automatic cancellation after a duration
2. **AbortSignal** - Client-side signal for manual cancellation
3. **Handler AbortSignal** - Server-side signal for cleanup

## Timeouts

### Default Timeout

Set a default timeout for all client requests:

```ts
const client = new AtBusClient(port, {
  timeoutMs: 10000, // 10 seconds for all calls
});

try {
  const result = await client.call("/operation", null);
} catch (error) {
  if (error instanceof AtBusRemoteError && error.code === "TIMEOUT") {
    console.error("Request timed out after 10 seconds");
  }
}
```

### Per-Request Timeout

Override the default for specific requests:

```ts
const client = new AtBusClient(port, {
  timeoutMs: 10000, // Default: 10s
});

// Quick operation with short timeout
const quick = await client.call("/quick", null, { timeoutMs: 500 });

// Slow operation with longer timeout
const slow = await client.call("/slow", null, { timeoutMs: 60000 });

// Wait indefinitely
const infinite = await client.call("/background-job", null, { timeoutMs: Infinity });
```

### Timeout Error

When a timeout occurs:

```ts
try {
  await client.call("/operation", null);
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    console.log(error.code);      // "TIMEOUT"
    console.log(error.message);   // "AtBus request timed out for route /operation"
    console.log(error.retriable); // true (safe to retry)
    console.log(error.route);     // "/operation"
  }
}
```

### Timeout Effects

When a timeout occurs:
1. Client rejects the promise
2. Client sends a cancel message to server
3. Server's `AbortSignal` fires if handler is still running
4. Handler can listen and clean up

## Request Cancellation with AbortSignal

### Basic Cancellation

```ts
const controller = new AbortController();

// Start request
const promise = client.call("/operation", null, {
  signal: controller.signal,
});

// Cancel after 2 seconds
setTimeout(() => controller.abort(), 2000);

try {
  await promise;
} catch (error) {
  if (error instanceof AtBusRemoteError && error.code === "CANCELLED") {
    console.log("Request was cancelled by user");
  }
}
```

### Cancelling Multiple Requests

```ts
const controller = new AbortController();

const promises = [
  client.call("/task1", null, { signal: controller.signal }),
  client.call("/task2", null, { signal: controller.signal }),
  client.call("/task3", null, { signal: controller.signal }),
];

// Cancel all at once
setTimeout(() => controller.abort(), 5000);

try {
  await Promise.all(promises);
} catch (error) {
  console.log("One or more requests cancelled");
}
```

### Race Pattern

Cancel a request if something else happens first:

```ts
const controller = new AbortController();

// Start the request
const requestPromise = client.call("/operation", null, {
  signal: controller.signal,
});

// Another operation that might complete first
const otherPromise = new Promise((resolve) => {
  setTimeout(resolve, 3000);
});

// Cancel request if other operation finishes first
otherPromise.then(() => controller.abort());

try {
  await requestPromise;
} catch (error) {
  if (error instanceof AtBusRemoteError && error.code === "CANCELLED") {
    console.log("Request cancelled because other operation finished");
  }
}
```

## Handler Cancellation (Server-Side)

### Listening for Abort Signal

Handlers receive an `AbortSignal` in the context:

```ts
server.at("/long-operation", async (payload, ctx) => {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({ success: true });
    }, 10000);

    // Listen for client cancellation
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Operation cancelled by client"));
    });
  });
});
```

### Early Termination

Stop processing when cancelled:

```ts
server.at("/process-items", async (payload, ctx) => {
  const items = payload as string[];
  const results = [];

  for (const item of items) {
    // Check if cancelled
    if (ctx.signal.aborted) {
      throw new Error("Processing cancelled");
    }

    // Process item
    const result = await processItem(item);
    results.push(result);
  }

  return { results };
});
```

### Cleanup on Abort

```ts
server.at("/download-file", async (payload, ctx) => {
  const filePath = payload.path as string;
  
  // Create a resource that needs cleanup
  const handle = await openFile(filePath);

  try {
    // Listen for abort to clean up
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        handle.close();
        reject(new Error("Download cancelled"));
      };

      ctx.signal.addEventListener("abort", cleanup, { once: true });

      // Perform download
      downloadFile(handle)
        .then(() => {
          ctx.signal.removeEventListener("abort", cleanup);
          handle.close();
          resolve();
        })
        .catch(reject);
    });

    return { success: true };
  } catch (error) {
    handle.close();
    throw error;
  }
});
```

### With AbortController

```ts
server.at("/background-process", async (payload, ctx) => {
  // Create your own controller
  const controller = new AbortController();

  // Forward client abort to your operations
  const forwardAbort = () => controller.abort();
  ctx.signal.addEventListener("abort", forwardAbort);

  try {
    const result = await complexOperation(payload, controller.signal);
    return result;
  } finally {
    ctx.signal.removeEventListener("abort", forwardAbort);
  }
});

async function complexOperation(
  payload: unknown,
  signal: AbortSignal
): Promise<unknown> {
  // Listen to signal in your async code
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // ... do work ...
}
```

## Combining Timeout and Cancellation

### Using Both

```ts
const controller = new AbortController();

try {
  const result = await client.call("/operation", null, {
    timeoutMs: 30000,           // Auto-cancel after 30s
    signal: controller.signal,  // Allow manual cancel too
  });
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    if (error.code === "TIMEOUT") {
      console.log("Timeout (automatic)");
    } else if (error.code === "CANCELLED") {
      console.log("Cancelled (manual)");
    }
  }
}

// Manual cancellation
button.onclick = () => controller.abort();
```

### With Deadline

Whichever comes first (timeout or deadline):

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

// Call with 5 second deadline
const result = await callWithDeadline("/operation", null, 5000);
```

## Progressive Cancellation

### Client-Server Cascade

```ts
// Server: Progressive cleanup
server.at("/stream-data", async (payload, ctx) => {
  const results = [];

  for (let i = 0; i < 1000; i++) {
    // Check frequently
    if (ctx.signal.aborted) {
      console.log(`Stopped at iteration ${i}`);
      throw new Error("aborted");
    }

    results.push(await fetchData(i));
  }

  return { results, complete: true };
});

// Client: Cancel if taking too long
const controller = new AbortController();
const timer = setTimeout(() => {
  console.log("Taking too long, cancelling...");
  controller.abort();
}, 5000);

try {
  const result = await client.call("/stream-data", null, {
    signal: controller.signal,
  });
  console.log("Complete:", result.results.length);
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    console.log("Stopped at:", error.details?.iteration);
  }
} finally {
  clearTimeout(timer);
}
```

## Handling Slow Operations

### Timeout with Fallback

```ts
async function callWithFallback<T>(
  client: AtBusClient,
  route: string,
  payload: unknown,
  primaryTimeoutMs: number,
  fallbackValue: T
): Promise<T> {
  try {
    return await client.call<T>(route, payload, {
      timeoutMs: primaryTimeoutMs,
    });
  } catch (error) {
    if (
      error instanceof AtBusRemoteError &&
      error.code === "TIMEOUT"
    ) {
      console.warn("Request timed out, using fallback");
      return fallbackValue;
    }
    throw error;
  }
}

// Usage
const user = await callWithFallback(
  "/user/profile",
  null,
  2000,
  { id: "unknown", name: "Guest" }
);
```

### Retry with Exponential Backoff

```ts
async function callWithRetryAndTimeout<T>(
  client: AtBusClient,
  route: string,
  payload: unknown,
  maxRetries = 3,
  baseTimeoutMs = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Increase timeout with each retry
      const timeoutMs = baseTimeoutMs * Math.pow(2, attempt);

      return await client.call<T>(route, payload, { timeoutMs });
    } catch (error) {
      lastError = error;

      if (
        error instanceof AtBusRemoteError &&
        !error.retriable
      ) {
        throw error; // Don't retry non-retriable errors
      }

      // Exponential backoff between retries
      const delay = Math.pow(2, attempt) * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

## Detecting Cancellation vs Timeout

```ts
try {
  await client.call("/operation", null, {
    timeoutMs: 5000,
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof AtBusRemoteError) {
    switch (error.code) {
      case "TIMEOUT":
        console.log("Timed out (automatic)");
        // Maybe show "operation taking too long" message
        break;
      case "CANCELLED":
        console.log("User cancelled");
        // Maybe show "operation cancelled" message
        break;
      default:
        console.log("Other error:", error.message);
    }
  }
}
```

## Best Practices

1. **Set reasonable timeouts** - Too short causes false timeouts, too long frustrates users
2. **Always handle cancellation in handlers** - Check `ctx.signal.aborted` frequently
3. **Clean up resources** - Close files, stop timers, etc. on abort
4. **Use try/finally for cleanup** - Ensures cleanup even on error
5. **Log cancellation** - Helps debug timeout issues
6. **Retry only retriable errors** - Check `error.retriable`
7. **Combine timeout with cancellation** - Gives users control while guaranteeing timeout
8. **Test cancellation paths** - Easy to forget and cause resource leaks

## Common Error Patterns

### Not Checking Signal

```ts
// ✗ BAD: Runs to completion even after cancel
server.at("/operation", async () => {
  await new Promise(resolve => setTimeout(resolve, 10000));
  return { done: true };
});

// ✓ GOOD: Checks signal
server.at("/operation", async (_, ctx) => {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 10000);
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    });
  });
  return { done: true };
});
```

### Not Cleaning Up

```ts
// ✗ BAD: Resource leak if aborted
server.at("/process", async (_, ctx) => {
  const db = await openDatabase();
  return db.query("SELECT...");
  // Database connection never closed if cancelled
});

// ✓ GOOD: Guaranteed cleanup
server.at("/process", async (_, ctx) => {
  const db = await openDatabase();
  try {
    return db.query("SELECT...");
  } finally {
    db.close();
  }
});
```

## See Also

- [AtBus Client Guide](./client-guide.md)
- [AtBus Server Guide](./server-guide.md)
- [Routing Guide](./routing.md)
- [Main README](../README.md)

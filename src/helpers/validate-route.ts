/** Ensures routes are valid literal or regex handlers for AtBus. */
export const validateRoute = (route: string | RegExp): void => {
  if (route instanceof RegExp) return;
  if (!route.startsWith("/")) {
    throw new Error(`AtBus route must start with '/': ${route}`);
  }
};

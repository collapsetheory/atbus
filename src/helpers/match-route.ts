export const matchRoute = (
  route: string | RegExp,
  url: string,
): Record<string, string> | null => {
  if (route instanceof RegExp) {
    return route.test(url) ? {} : null;
  }

  if (!route.includes(":")) {
    return route === url ? {} : null;
  }

  const routeParts = route.split("/").filter(Boolean);
  const urlParts = url.split("/").filter(Boolean);
  if (routeParts.length !== urlParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < routeParts.length; i += 1) {
    const routePart = routeParts[i];
    const urlPart = urlParts[i];
    if (routePart.startsWith(":")) {
      const key = routePart.slice(1);
      if (!key) return null;
      params[key] = urlPart;
      continue;
    }
    if (routePart !== urlPart) return null;
  }

  return params;
};

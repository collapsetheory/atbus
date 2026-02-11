/** Returns UTF-8 byte size of a JSON payload, or infinity when serialization fails. */
export const payloadSizeBytes = (payload: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

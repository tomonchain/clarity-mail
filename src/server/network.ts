// Error codes for a dropped connection or a mail server that can't be reached.
const NETWORK_CODES = new Set([
  "ETIMEOUT",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "NoConnection",
]);

export function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && NETWORK_CODES.has(code);
}

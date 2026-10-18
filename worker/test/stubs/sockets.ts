// Stub for Cloudflare's `cloudflare:sockets` module, which is unavailable in
// the Node test environment. `sendEmail` imports `connect` but never calls it
// in these tests, so this only needs to satisfy the import.
export function connect(): never {
  throw new Error("cloudflare:sockets connect is not available in unit tests");
}

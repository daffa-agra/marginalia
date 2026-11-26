/**
 * Minimal ambient types for the Cloudflare APIs this Worker touches, so the
 * worker typechecks without pulling in a dependencies tree. Kept honest and
 * small; widen as new APIs are used.
 */

declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  allRecord(): Promise<{ results: Array<Record<string, unknown>> }>;
}

declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}
/**
 * `server-only` throws on import outside a React Server Component, which is
 * exactly what it is for -- and exactly what stops Vitest importing modules
 * that carry the marker. Aliased in vitest.config.ts so the guard stays real in
 * the application and disappears under test.
 */
export {};

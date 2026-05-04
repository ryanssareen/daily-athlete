/**
 * In-memory Supabase client double for route-handler tests.
 *
 * The route handlers in `app/api/` use the fluent supabase-js builder:
 *   supabase.from("users").select(...).eq("id", claims.sub).maybeSingle()
 * Our local Postgres test fixtures don't speak PostgREST, so vitest tests for
 * routes mock `@/server/supabase` and supply this fake. It implements only the
 * subset of the chain those handlers actually call:
 *   from(table)
 *     .select(columns)
 *     .eq(column, value)
 *     .maybeSingle() | .single() | terminal-resolve
 *     .update(values)        // returns a builder that .eq() resolves
 *
 * Filters are applied in JS over the rows seeded in the constructor. That's
 * enough to verify handler logic (auth flow, 401/404/200 routing, response
 * shape transformation). Real PostgREST behavior is verified separately by
 * the Playwright e2e suite against the deployed Supabase project.
 */
import { vi, type Mock } from "vitest";

export interface SupabaseFakeOptions {
  /** Forces `.from(table)...` to resolve with `{data: null, error: this}`. */
  failNextSelect?: { table: string; error: unknown };
  /** Forces the next .update(...) to resolve with `{error: this}`. */
  failNextUpdate?: { table: string; error: unknown };
}

interface RowDictionary {
  [table: string]: Record<string, unknown>[];
}

type FluentResult<T> = Promise<{ data: T; error: unknown }>;

/**
 * Build a fake Supabase client over the given seeded rows. Returns the client
 * plus the row store; tests can mutate rows after construction to simulate
 * subsequent reads.
 */
export function makeSupabaseFake(seed: RowDictionary, opts: SupabaseFakeOptions = {}) {
  const rows: RowDictionary = JSON.parse(JSON.stringify(seed));
  const updateMock: Mock = vi.fn();
  const selectMock: Mock = vi.fn();

  function builder(table: string) {
    let filters: Array<{ column: string; value: unknown }> = [];
    let pendingUpdate: Record<string, unknown> | null = null;

    function applyFilters(set: Record<string, unknown>[]): Record<string, unknown>[] {
      return set.filter((row) => filters.every((f) => row[f.column] === f.value));
    }

    const chain = {
      select: (_columns: string) => {
        selectMock(table, _columns);
        if (opts.failNextSelect && opts.failNextSelect.table === table) {
          const err = opts.failNextSelect.error;
          opts.failNextSelect = undefined;
          chain.maybeSingle = (() => Promise.resolve({ data: null, error: err })) as never;
          chain.single = (() => Promise.resolve({ data: null, error: err })) as never;
          // For non-singular reads, expose a thenable that resolves to error too.
          (chain as { then?: unknown }).then = ((onFulfilled: (v: unknown) => unknown) =>
            onFulfilled({ data: null, error: err })) as never;
        }
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return chain;
      },
      maybeSingle: <T,>(): FluentResult<T | null> => {
        const matched = applyFilters(rows[table] ?? []);
        const data = (matched[0] ?? null) as T | null;
        return Promise.resolve({ data, error: null });
      },
      single: <T,>(): FluentResult<T> => {
        const matched = applyFilters(rows[table] ?? []);
        if (matched.length === 0) {
          return Promise.resolve({
            data: null as unknown as T,
            error: { code: "PGRST116", message: "no rows" },
          });
        }
        return Promise.resolve({ data: matched[0] as T, error: null });
      },
      // Terminal resolve for plain list queries (`.eq().then`).
      then: <T,>(
        onFulfilled: (v: { data: T; error: unknown }) => unknown,
      ): unknown => {
        const matched = applyFilters(rows[table] ?? []);
        return Promise.resolve(onFulfilled({ data: matched as T, error: null }));
      },
      update: (values: Record<string, unknown>) => {
        updateMock(table, values);
        pendingUpdate = values;
        if (opts.failNextUpdate && opts.failNextUpdate.table === table) {
          const err = opts.failNextUpdate.error;
          opts.failNextUpdate = undefined;
          return {
            eq: (_c: string, _v: unknown) => Promise.resolve({ error: err }),
          };
        }
        return {
          eq: (column: string, value: unknown) => {
            const target = (rows[table] ?? []).find((r) => r[column] === value);
            if (target && pendingUpdate) Object.assign(target, pendingUpdate);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return chain;
  }

  const client = {
    from: vi.fn(builder),
  };

  return { client, rows, mocks: { update: updateMock, select: selectMock } };
}

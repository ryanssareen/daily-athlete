import type { SupabaseClient } from "@supabase/supabase-js";

export interface FakeTable {
  data?: unknown[] | null;
  error?: { message: string } | null;
}

export interface RecordedQuery {
  table: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
}

export function fakeAdmin(tables: Record<string, FakeTable>): {
  client: SupabaseClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, filters: [] };
      queries.push(query);
      const result = () => {
        const t = tables[table] ?? { data: [] };
        return { data: t.data ?? [], error: t.error ?? null };
      };
      const builder: Record<string, unknown> = {};
      const chain = (op: string) => (column: string, value?: unknown) => {
        query.filters.push({ op, column, value });
        return builder;
      };
      builder.select = () => builder;
      builder.eq = chain("eq");
      builder.is = chain("is");
      builder.in = chain("in");
      builder.gte = chain("gte");
      builder.order = () => builder;
      builder.maybeSingle = () => {
        const r = result();
        return Promise.resolve({ data: (r.data as unknown[])[0] ?? null, error: r.error });
      };
      builder.then = (resolve: (value: unknown) => unknown) => resolve(result());
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, queries };
}

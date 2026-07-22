export type MktSupabaseError = {
  code?: string;
  message: string;
};

type MktQueryResult<T> = {
  data: T | null;
  error: MktSupabaseError | null;
};

type RowFromResult<T> = T extends Array<infer TRow> ? TRow : T;

export interface MktQuery<T> extends PromiseLike<MktQueryResult<T>> {
  select(columns?: string): MktQuery<T>;
  eq(column: string, value: unknown): MktQuery<T>;
  like(column: string, pattern: string): MktQuery<T>;
  is(column: string, value: unknown): MktQuery<T>;
  gt(column: string, value: unknown): MktQuery<T>;
  lte(column: string, value: unknown): MktQuery<T>;
  contains(column: string, value: unknown): MktQuery<T>;
  in(column: string, values: readonly unknown[]): MktQuery<T>;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): MktQuery<T>;
  delete(): MktQuery<T>;
  limit(count: number): MktQuery<T>;
  single(): MktQuery<RowFromResult<T>>;
  maybeSingle(): MktQuery<RowFromResult<T>>;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): MktQuery<T>;
  update(values: Record<string, unknown>): MktQuery<T>;
  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string },
  ): MktQuery<T>;
}

export type MktDatabaseClient = {
  from<TRow = Record<string, unknown>>(table: string): MktQuery<TRow[]>;
  rpc<TResult = unknown>(
    functionName: string,
    args?: Record<string, unknown>,
  ): PromiseLike<MktQueryResult<TResult>>;
};

/**
 * Temporary typed boundary for MKT tables added by migration 00168.
 * Regenerate the shared Supabase Database type after staging applies the migration.
 */
export function getMktDatabaseClient(client: unknown): MktDatabaseClient {
  return client as MktDatabaseClient;
}

// Single browser-side Supabase client for the whole dashboard.
// Only the public (publishable) key ever reaches browser code.
import { supabase as generatedClient } from "@/integrations/supabase/client";

type AnyResult = Promise<{ data: unknown; error: { message: string } | null }>;

interface QueryBuilder extends AnyResult {
  select: (columns: string) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
}

/**
 * The generated `Database` type does not describe the PostGIS views/RPCs of
 * this PoC schema, so the client is re-exported through a narrow structural
 * type. Row shapes are enforced by the interfaces in `src/types/medical.ts`.
 */
export interface MedicalSupabaseClient {
  from: (relation: string) => QueryBuilder;
  rpc: (fn: string, args: Record<string, unknown>) => AnyResult;
  channel: (typeof generatedClient)["channel"];
  removeChannel: (typeof generatedClient)["removeChannel"];
}

export const supabase = generatedClient as unknown as MedicalSupabaseClient;
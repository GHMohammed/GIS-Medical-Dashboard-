import { supabase } from "./supabase";
import type { HistoricalSnapshot } from "@/types/medical";

/** Historical values come only from the snapshot RPC, never from live state. */
export async function getHistoricalSnapshot(selectedDateTime: Date): Promise<HistoricalSnapshot> {
  const { data, error } = await supabase.rpc("get_historical_snapshot", {
    p_timestamp: selectedDateTime.toISOString(),
  });
  if (error) throw new Error(error.message);

  const snapshot = data as unknown as HistoricalSnapshot;
  return {
    timestamp: snapshot?.timestamp ?? selectedDateTime.toISOString(),
    ambulances: (snapshot?.ambulances ?? []).map((a) => ({
      ...a,
      speed_kmh: Number(a.speed_kmh),
      heading_degrees: a.heading_degrees === null ? null : Number(a.heading_degrees),
    })),
    facilities: (snapshot?.facilities ?? []).map((f) => ({
      ...f,
      occupancy_rate: Number(f.occupancy_rate),
    })),
  };
}
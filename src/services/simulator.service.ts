import { supabase } from "./supabase";

export interface SimulatorState {
  enabled: boolean;
  last_tick_at: string | null;
  tick_count: number;
}

/**
 * The simulator lives entirely in PostgreSQL (pg_cron runs `simulate_tick()`
 * every 5 seconds). The browser only reads and toggles it.
 */
export async function fetchSimulatorState(): Promise<SimulatorState | null> {
  const { data, error } = await supabase.from("simulator_settings").select("*").limit(1);
  if (error) return null;
  const row = (data as SimulatorState[] | null)?.[0];
  return row ?? null;
}

export async function setSimulatorEnabled(enabled: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("set_simulator_enabled", { p_enabled: enabled });
  return !error;
}
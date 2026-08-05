import { supabase } from "./supabase";
import type { RoutingResult } from "@/types/medical";

export type DispatchFailureCode =
  | "NO_AVAILABLE_AMBULANCE"
  | "EMERGENCY_NOT_ACTIVE"
  | "NOT_FOUND"
  | "VALIDATION"
  | "NETWORK";

export interface DispatchOutcome {
  ok: boolean;
  code?: DispatchFailureCode;
  result?: RoutingResult;
}

function classify(message: string): DispatchFailureCode {
  const m = message.toLowerCase();
  if (m.includes("is not active")) return "EMERGENCY_NOT_ACTIVE";
  if (m.includes("does not exist")) return "NOT_FOUND";
  if (m.includes("fetch") || m.includes("network")) return "NETWORK";
  return "VALIDATION";
}

/**
 * PostgreSQL is authoritative: it picks and locks the nearest available
 * ambulance, writes the dispatch, updates statuses and raises alerts.
 * React never chooses an ambulance.
 */
export async function processEmergencyRouting(
  emergencyId: string,
  selectedHospitalId: string,
): Promise<DispatchOutcome> {
  const { data, error } = await supabase.rpc("process_emergency_routing", {
    p_hospital_id: selectedHospitalId,
    p_emergency_id: emergencyId,
  });

  if (error) {
    return { ok: false, code: classify(error.message) };
  }

  const result = data as unknown as RoutingResult;
  if (!result?.success) {
    return {
      ok: false,
      code: result?.reason === "NO_AVAILABLE_AMBULANCE" ? "NO_AVAILABLE_AMBULANCE" : "VALIDATION",
      result,
    };
  }
  return { ok: true, result };
}

export async function completeDispatch(dispatchId: string): Promise<boolean> {
  const { error } = await supabase.rpc("complete_dispatch", { p_dispatch_id: dispatchId });
  return !error;
}
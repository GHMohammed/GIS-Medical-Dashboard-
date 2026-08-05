import { supabase } from "./supabase";
import type {
  Ambulance,
  DispatchAssignment,
  EmergencyIncident,
  MedicalAlert,
  MedicalFacility,
} from "@/types/medical";

/**
 * All database -> UI mapping lives here. Views expose plain longitude/latitude
 * columns (ST_X/ST_Y), so no PostGIS string is ever parsed in a component.
 */

function unwrap<T>(data: T[] | null, error: { message: string } | null): T[] {
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchFacilities(): Promise<MedicalFacility[]> {
  const { data, error } = await supabase
    .from("medical_facilities_map")
    .select("*")
    .order("name", { ascending: true });
  return unwrap(data as MedicalFacility[] | null, error).map((f) => ({
    ...f,
    occupancy_rate: Number(f.occupancy_rate),
  }));
}

export async function fetchAmbulances(): Promise<Ambulance[]> {
  const { data, error } = await supabase
    .from("ambulances_map")
    .select("*")
    .order("plate_number", { ascending: true });
  return unwrap(data as Ambulance[] | null, error).map((a) => ({
    ...a,
    speed_kmh: Number(a.speed_kmh),
    heading_degrees: a.heading_degrees === null ? null : Number(a.heading_degrees),
  }));
}

export async function fetchEmergencies(): Promise<EmergencyIncident[]> {
  const { data, error } = await supabase
    .from("emergency_incidents_map")
    .select("*")
    .order("created_at", { ascending: false });
  return unwrap(data as EmergencyIncident[] | null, error);
}

export async function fetchAlerts(): Promise<MedicalAlert[]> {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  return unwrap(data as MedicalAlert[] | null, error);
}

export async function fetchDispatches(): Promise<DispatchAssignment[]> {
  const { data, error } = await supabase
    .from("dispatch_assignments_details")
    .select("*")
    .order("assigned_at", { ascending: false })
    .limit(100);
  return unwrap(data as DispatchAssignment[] | null, error).map((d) => ({
    ...d,
    ambulance_to_emergency_distance_meters: Number(d.ambulance_to_emergency_distance_meters),
    emergency_to_hospital_distance_meters: Number(d.emergency_to_hospital_distance_meters),
    hospital_occupancy_rate: Number(d.hospital_occupancy_rate),
  }));
}

export interface DashboardSnapshot {
  facilities: MedicalFacility[];
  ambulances: Ambulance[];
  emergencies: EmergencyIncident[];
  alerts: MedicalAlert[];
  dispatches: DispatchAssignment[];
}

/** Full authoritative read. Used on load and again after every reconnection. */
export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [facilities, ambulances, emergencies, alerts, dispatches] = await Promise.all([
    fetchFacilities(),
    fetchAmbulances(),
    fetchEmergencies(),
    fetchAlerts(),
    fetchDispatches(),
  ]);
  return { facilities, ambulances, emergencies, alerts, dispatches };
}

export async function markAlertRead(alertId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_alert_read", { p_alert_id: alertId });
  if (error) throw new Error(error.message);
}
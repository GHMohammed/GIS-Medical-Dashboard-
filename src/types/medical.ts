export type FacilityType = "central_hospital" | "clinic" | "field_medical_point";
export type FacilityStatus = "GREEN" | "RED";
export type AmbulanceStatus = "available" | "busy" | "out_of_service";
export type EmergencyStatus = "active" | "dispatched" | "resolved" | "cancelled";
export type EmergencySeverity = "low" | "medium" | "high" | "critical";
export type AlertType =
  | "high_occupancy"
  | "emergency_created"
  | "ambulance_dispatched"
  | "no_ambulance_available"
  | "dispatch_completed";

export interface MedicalFacility {
  id: string;
  name: string;
  facility_type: FacilityType;
  governorate: string;
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  occupancy_rate: number;
  status: FacilityStatus;
  longitude: number;
  latitude: number;
  created_at: string;
  updated_at: string;
}

export interface Ambulance {
  id: string;
  plate_number: string;
  governorate: string;
  status: AmbulanceStatus;
  longitude: number;
  latitude: number;
  heading_degrees: number | null;
  speed_kmh: number;
  created_at: string;
  updated_at: string;
}

export interface EmergencyIncident {
  id: string;
  title: string;
  description: string | null;
  severity: EmergencySeverity;
  status: EmergencyStatus;
  governorate: string;
  longitude: number;
  latitude: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface MedicalAlert {
  id: string;
  alert_type: AlertType;
  severity: EmergencySeverity;
  title: string;
  message: string;
  facility_id: string | null;
  ambulance_id: string | null;
  emergency_id: string | null;
  dispatch_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface DispatchAssignment {
  id: string;
  emergency_id: string;
  emergency_title: string;
  emergency_severity: EmergencySeverity;
  emergency_status: EmergencyStatus;
  emergency_longitude: number;
  emergency_latitude: number;
  hospital_id: string;
  hospital_name: string;
  hospital_longitude: number;
  hospital_latitude: number;
  ambulance_id: string;
  ambulance_plate_number: string;
  ambulance_longitude: number;
  ambulance_latitude: number;
  ambulance_to_emergency_distance_meters: number;
  emergency_to_hospital_distance_meters: number;
  hospital_occupancy_rate: number;
  hospital_status: FacilityStatus;
  assigned_at: string;
  completed_at: string | null;
  manually_overridden: boolean;
}

export interface HistoricalAmbulance {
  ambulance_id: string;
  plate_number: string;
  governorate: string;
  status: AmbulanceStatus;
  longitude: number;
  latitude: number;
  heading_degrees: number | null;
  speed_kmh: number;
  recorded_at: string;
}

export interface HistoricalFacility {
  facility_id: string;
  name: string;
  facility_type: FacilityType;
  governorate: string;
  longitude: number;
  latitude: number;
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  occupancy_rate: number;
  status: FacilityStatus;
  recorded_at: string;
}

export interface HistoricalSnapshot {
  timestamp: string;
  ambulances: HistoricalAmbulance[];
  facilities: HistoricalFacility[];
}

/** JSON payload returned by the `process_emergency_routing` RPC. */
export interface RoutingResult {
  success: boolean;
  reason?: "NO_AVAILABLE_AMBULANCE";
  dispatch_id?: string;
  emergency_id: string;
  hospital_id: string;
  hospital_name: string;
  hospital_status: FacilityStatus;
  alert_triggered: boolean;
  available_beds: number;
  occupancy_rate: number;
  assigned_ambulance_id: string | null;
  assigned_ambulance_plate: string | null;
  ambulance_to_emergency_distance_meters: number | null;
  emergency_to_hospital_distance_meters: number | null;
  ambulance_location?: { longitude: number; latitude: number };
  emergency_location?: { longitude: number; latitude: number };
  hospital_location?: { longitude: number; latitude: number };
}

export type RealtimeStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export type EntityKind = "facility" | "ambulance" | "emergency" | "dispatch";

export interface FocusTarget {
  kind: EntityKind;
  id: string;
  /** Bumped on every focus request so repeated clicks re-trigger the map. */
  nonce: number;
}

export interface DashboardFilters {
  governorate: string;
  facilityType: FacilityType | "all";
  facilityStatus: FacilityStatus | "all";
  ambulanceStatus: AmbulanceStatus | "all";
  emergencySeverity: EmergencySeverity | "all";
  search: string;
}

export const EMPTY_FILTERS: DashboardFilters = {
  governorate: "all",
  facilityType: "all",
  facilityStatus: "all",
  ambulanceStatus: "all",
  emergencySeverity: "all",
  search: "",
};
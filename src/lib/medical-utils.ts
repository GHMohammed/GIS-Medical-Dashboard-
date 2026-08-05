import type {
  Ambulance,
  DashboardFilters,
  EmergencyIncident,
  MedicalFacility,
} from "@/types/medical";

export function matchesGovernorate(value: string, filters: DashboardFilters) {
  return filters.governorate === "all" || value === filters.governorate;
}

export function filterFacilities(items: MedicalFacility[], filters: DashboardFilters) {
  const q = filters.search.trim().toLowerCase();
  return items.filter(
    (f) =>
      matchesGovernorate(f.governorate, filters) &&
      (filters.facilityType === "all" || f.facility_type === filters.facilityType) &&
      (filters.facilityStatus === "all" || f.status === filters.facilityStatus) &&
      (q === "" || f.name.toLowerCase().includes(q)),
  );
}

export function filterAmbulances(items: Ambulance[], filters: DashboardFilters) {
  const q = filters.search.trim().toLowerCase();
  return items.filter(
    (a) =>
      matchesGovernorate(a.governorate, filters) &&
      (filters.ambulanceStatus === "all" || a.status === filters.ambulanceStatus) &&
      (q === "" || a.plate_number.toLowerCase().includes(q)),
  );
}

export function filterEmergencies(items: EmergencyIncident[], filters: DashboardFilters) {
  const q = filters.search.trim().toLowerCase();
  return items.filter(
    (e) =>
      matchesGovernorate(e.governorate, filters) &&
      (filters.emergencySeverity === "all" || e.severity === filters.emergencySeverity) &&
      (q === "" || e.title.toLowerCase().includes(q)),
  );
}

export function countActiveFilters(filters: DashboardFilters) {
  let n = 0;
  if (filters.governorate !== "all") n++;
  if (filters.facilityType !== "all") n++;
  if (filters.facilityStatus !== "all") n++;
  if (filters.ambulanceStatus !== "all") n++;
  if (filters.emergencySeverity !== "all") n++;
  if (filters.search.trim() !== "") n++;
  return n;
}

export function formatDistance(meters: number, lang: "ar" | "en") {
  const locale = lang === "ar" ? "ar-SY" : "en-GB";
  if (meters >= 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} ${
      lang === "ar" ? "كم" : "km"
    }`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(meters)} ${
    lang === "ar" ? "متر" : "m"
  }`;
}

/** Fallback view centred on Syria when nothing is selected. */
export const SYRIA_CENTER: [number, number] = [34.9, 37.6];
export const SYRIA_ZOOM = 7;
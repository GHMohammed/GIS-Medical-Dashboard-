import L from "leaflet";
import type { AmbulanceStatus, EmergencySeverity, FacilityStatus } from "@/types/medical";

const hospitalPath = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v12M6 12h12"/></svg>`;
const ambulancePath = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17V8h11v9"/><path d="M14 11h4l3 3v3h-7"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="17.5" cy="17.5" r="1.6"/></svg>`;
const emergencyPath = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v9"/><circle cx="12" cy="18" r="1"/></svg>`;

function makeIcon(className: string, svg: string, focused: boolean) {
  return L.divIcon({
    className: "ops-marker",
    html: `<div class="ops-pin ${className}${focused ? " ops-pin--focused" : ""}">${svg}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
}

export function facilityIcon(status: FacilityStatus, focused = false) {
  return makeIcon(`ops-pin--facility-${status.toLowerCase()}`, hospitalPath, focused);
}

export function ambulanceIcon(status: AmbulanceStatus, focused = false) {
  return makeIcon(`ops-pin--ambulance-${status}`, ambulancePath, focused);
}

export function emergencyIcon(severity: EmergencySeverity, focused = false) {
  return makeIcon(`ops-pin--emergency-${severity}`, emergencyPath, focused);
}

export function clusterIcon(count: number) {
  const size = count < 10 ? 32 : count < 50 ? 38 : 44;
  return L.divIcon({
    html: `<div class="ops-cluster" style="width:${size}px;height:${size}px">${count}</div>`,
    className: "ops-marker",
    iconSize: L.point(size, size, true),
  });
}
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import { ambulanceIcon, clusterIcon, emergencyIcon, facilityIcon } from "./markerIcons";
import { useI18n } from "@/i18n";
import { SYRIA_CENTER, SYRIA_ZOOM } from "@/lib/medical-utils";
import type {
  Ambulance,
  EmergencyIncident,
  FocusTarget,
  MedicalFacility,
  RoutingResult,
} from "@/types/medical";

export interface OpsMapProps {
  facilities: MedicalFacility[];
  ambulances: Ambulance[];
  emergencies: EmergencyIncident[];
  routing: RoutingResult | null;
  focus: FocusTarget | null;
  onSelect: (target: { kind: FocusTarget["kind"]; id: string }) => void;
}

function FocusController({
  focus,
  point,
}: {
  focus: FocusTarget | null;
  point: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.flyTo(point, Math.max(map.getZoom(), 12), { duration: 0.8 });
  }, [focus?.nonce, point?.[0], point?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function PopupRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

export default function OpsMap({
  facilities,
  ambulances,
  emergencies,
  routing,
  focus,
  onSelect,
}: OpsMapProps) {
  const { t, gov, formatNumber } = useI18n();

  const focusPoint = useMemo<[number, number] | null>(() => {
    if (!focus) return null;
    const find = <T extends { id: string; latitude: number; longitude: number }>(list: T[]) =>
      list.find((i) => i.id === focus.id);
    const item =
      focus.kind === "facility"
        ? find(facilities)
        : focus.kind === "ambulance"
          ? find(ambulances)
          : find(emergencies);
    return item ? [item.latitude, item.longitude] : null;
  }, [focus, facilities, ambulances, emergencies]);

  const routeLines = useMemo(() => {
    if (!routing?.success || !routing.ambulance_location || !routing.emergency_location) return null;
    const amb: [number, number] = [
      routing.ambulance_location.latitude,
      routing.ambulance_location.longitude,
    ];
    const inc: [number, number] = [
      routing.emergency_location.latitude,
      routing.emergency_location.longitude,
    ];
    const hos: [number, number] | null = routing.hospital_location
      ? [routing.hospital_location.latitude, routing.hospital_location.longitude]
      : null;
    return { amb, inc, hos };
  }, [routing]);

  return (
    <MapContainer
      center={SYRIA_CENTER}
      zoom={SYRIA_ZOOM}
      className="h-full w-full"
      scrollWheelZoom
      preferCanvas
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />

      <FocusController focus={focus} point={focusPoint} />

      <MarkerClusterGroup
        chunkedLoading
        iconCreateFunction={(c: { getChildCount: () => number }) => clusterIcon(c.getChildCount())}
      >
        {facilities.map((f) => (
          <Marker
            key={`f-${f.id}`}
            position={[f.latitude, f.longitude]}
            icon={facilityIcon(f.status, focus?.kind === "facility" && focus.id === f.id)}
            eventHandlers={{ click: () => onSelect({ kind: "facility", id: f.id }) }}
          >
            <Popup>
              <div className="space-y-1.5 p-3">
                <p className="text-sm font-bold text-foreground">{f.name}</p>
                <PopupRow label={t("common.type")} value={t(`facility.${f.facility_type}`)} />
                <PopupRow label={t("common.governorate")} value={gov(f.governorate)} />
                <PopupRow
                  label={t("facility.occupancy")}
                  value={`${formatNumber(f.occupancy_rate, { maximumFractionDigits: 2 })}%`}
                />
                <PopupRow
                  label={t("facility.availableBeds")}
                  value={formatNumber(f.available_beds)}
                />
                <PopupRow label={t("facility.status")} value={t(`status.${f.status}`)} />
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>

      {ambulances.map((a) => (
        <Marker
          key={`a-${a.id}`}
          position={[a.latitude, a.longitude]}
          icon={ambulanceIcon(a.status, focus?.kind === "ambulance" && focus.id === a.id)}
          eventHandlers={{ click: () => onSelect({ kind: "ambulance", id: a.id }) }}
        >
          <Popup>
            <div className="space-y-1.5 p-3">
              <p className="text-sm font-bold text-foreground">{a.plate_number}</p>
              <PopupRow label={t("ambulance.status")} value={t(`ambulance.${a.status}`)} />
              <PopupRow label={t("common.governorate")} value={gov(a.governorate)} />
              <PopupRow
                label={t("ambulance.speed")}
                value={`${formatNumber(a.speed_kmh, { maximumFractionDigits: 1 })} ${t("common.kmh")}`}
              />
            </div>
          </Popup>
        </Marker>
      ))}

      {emergencies.map((e) => (
        <Marker
          key={`e-${e.id}`}
          position={[e.latitude, e.longitude]}
          icon={emergencyIcon(e.severity, focus?.kind === "emergency" && focus.id === e.id)}
          eventHandlers={{ click: () => onSelect({ kind: "emergency", id: e.id }) }}
        >
          <Popup>
            <div className="space-y-1.5 p-3">
              <p className="text-sm font-bold text-foreground">{e.title}</p>
              <PopupRow label={t("emergency.severity")} value={t(`severity.${e.severity}`)} />
              <PopupRow label={t("emergency.status")} value={t(`estatus.${e.status}`)} />
              <PopupRow label={t("common.governorate")} value={gov(e.governorate)} />
            </div>
          </Popup>
        </Marker>
      ))}

      {routeLines && (
        <>
          <Polyline
            positions={[routeLines.amb, routeLines.inc]}
            pathOptions={{ color: "#2878B5", weight: 4, dashArray: "8 8", opacity: 0.9 }}
          />
          {routeLines.hos && (
            <Polyline
              positions={[routeLines.inc, routeLines.hos]}
              pathOptions={{ color: "#168A63", weight: 4, dashArray: "8 8", opacity: 0.9 }}
            />
          )}
        </>
      )}
    </MapContainer>
  );
}
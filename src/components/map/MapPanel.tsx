import { Suspense, lazy } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { useI18n } from "@/i18n";
import type { OpsMapProps } from "./OpsMap";

// Leaflet touches `window` at import time, so the module itself must stay out
// of the SSR graph.
const OpsMap = lazy(() => import("./OpsMap"));

function MapSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-secondary">
      <p className="text-sm text-muted-foreground">Loading map…</p>
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  const items = [
    { cls: "ops-pin--facility-green", label: `${t("map.facilities")} · ${t("status.GREEN")}` },
    { cls: "ops-pin--facility-red", label: `${t("map.facilities")} · ${t("status.RED")}` },
    { cls: "ops-pin--ambulance-available", label: `${t("map.ambulances")} · ${t("ambulance.available")}` },
    { cls: "ops-pin--ambulance-busy", label: `${t("map.ambulances")} · ${t("ambulance.busy")}` },
    { cls: "ops-pin--emergency-critical", label: `${t("map.emergencies")} · ${t("severity.critical")}` },
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 z-[500] mx-4 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur ltr:left-4 rtl:right-4">
      <p className="mb-2 text-xs font-bold text-foreground">{t("map.legend")}</p>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.cls} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className={`inline-block size-3 rounded-full ${legendColor(i.cls)}`} />
            {i.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function legendColor(cls: string) {
  if (cls.includes("facility-green")) return "bg-ok";
  if (cls.includes("facility-red")) return "bg-critical";
  if (cls.includes("ambulance-available")) return "bg-gis";
  if (cls.includes("ambulance-busy")) return "bg-warn";
  return "bg-critical";
}

export function MapPanel(props: OpsMapProps) {
  return (
    <div className="relative isolate h-full w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <ClientOnly fallback={<MapSkeleton />}>
        <Suspense fallback={<MapSkeleton />}>
          <OpsMap {...props} />
        </Suspense>
      </ClientOnly>
      <Legend />
    </div>
  );
}
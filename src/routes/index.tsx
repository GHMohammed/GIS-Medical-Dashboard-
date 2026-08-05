import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPanel } from "@/components/map/MapPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { useMedicalRealtime } from "@/hooks/useMedicalRealtime";
import { fetchDashboardSnapshot, markAlertRead } from "@/services/medical.service";
import { completeDispatch, processEmergencyRouting } from "@/services/dispatch.service";
import { getHistoricalSnapshot } from "@/services/history.service";
import { fetchSimulatorState, setSimulatorEnabled } from "@/services/simulator.service";
import {
  countActiveFilters,
  filterAmbulances,
  filterEmergencies,
  filterFacilities,
  formatDistance,
} from "@/lib/medical-utils";
import { EMPTY_FILTERS } from "@/types/medical";
import type {
  DashboardFilters,
  FocusTarget,
  HistoricalSnapshot,
  RoutingResult,
} from "@/types/medical";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Syria Medical GIS Dashboard — Live Medical Operations Room" },
      {
        name: "description",
        content:
          "Real-time geographic dashboard for Syrian medical facilities, ambulances, emergency incidents and dispatch routing, with Arabic and English support.",
      },
      { property: "og:title", content: "Syria Medical GIS Dashboard" },
      {
        property: "og:description",
        content:
          "Monitor hospital bed occupancy, ambulance fleet status and emergency dispatch across Syria in real time.",
      },
    ],
  }),
  component: Dashboard,
});

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "critical" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-extrabold tabular-nums ${
          tone === "critical" ? "text-critical" : tone === "ok" ? "text-ok" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Dashboard() {
  const { t, gov, lang, dir, toggle, formatNumber, formatDateTime } = useI18n();
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [routing, setRouting] = useState<RoutingResult | null>(null);
  const [selectedEmergency, setSelectedEmergency] = useState<string | null>(null);
  const [selectedHospital, setSelectedHospital] = useState<string>("");
  const [historical, setHistorical] = useState<HistoricalSnapshot | null>(null);
  const [historyInput, setHistoryInput] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [simEnabled, setSimEnabled] = useState<boolean | null>(null);

  const isHistorical = historical !== null;

  const query = useQuery({
    queryKey: ["dashboard-snapshot"],
    queryFn: fetchDashboardSnapshot,
    refetchOnWindowFocus: false,
  });

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const rtStatus = useMedicalRealtime({ enabled: !isHistorical, onChange: refresh });

  const simQuery = useQuery({
    queryKey: ["simulator-state"],
    queryFn: fetchSimulatorState,
    refetchInterval: 15_000,
  });
  const simOn = simEnabled ?? simQuery.data?.enabled ?? false;

  const live = query.data;

  const facilities = useMemo(() => {
    if (isHistorical) {
      return historical.facilities.map((f) => ({
        id: f.facility_id,
        name: f.name,
        facility_type: f.facility_type,
        governorate: f.governorate,
        total_beds: f.total_beds,
        occupied_beds: f.occupied_beds,
        available_beds: f.available_beds,
        occupancy_rate: f.occupancy_rate,
        status: f.status,
        longitude: f.longitude,
        latitude: f.latitude,
        created_at: f.recorded_at,
        updated_at: f.recorded_at,
      }));
    }
    return live?.facilities ?? [];
  }, [isHistorical, historical, live]);

  const ambulances = useMemo(() => {
    if (isHistorical) {
      return historical.ambulances.map((a) => ({
        id: a.ambulance_id,
        plate_number: a.plate_number,
        governorate: a.governorate,
        status: a.status,
        longitude: a.longitude,
        latitude: a.latitude,
        heading_degrees: a.heading_degrees,
        speed_kmh: a.speed_kmh,
        created_at: a.recorded_at,
        updated_at: a.recorded_at,
      }));
    }
    return live?.ambulances ?? [];
  }, [isHistorical, historical, live]);

  const emergencies = isHistorical ? [] : (live?.emergencies ?? []);
  const alerts = isHistorical ? [] : (live?.alerts ?? []);
  const dispatches = isHistorical ? [] : (live?.dispatches ?? []);

  const shownFacilities = filterFacilities(facilities, filters);
  const shownAmbulances = filterAmbulances(ambulances, filters);
  const shownEmergencies = filterEmergencies(emergencies, filters);

  const governorates = useMemo(
    () => Array.from(new Set(facilities.map((f) => f.governorate))).sort(),
    [facilities],
  );

  const focusOn = (kind: FocusTarget["kind"], id: string) =>
    setFocus({ kind, id, nonce: Date.now() });

  /** Hospitals ranked by free capacity — the operator's most useful ordering. */
  const dispatchTargets = useMemo(
    () => [...facilities].sort((a, b) => b.available_beds - a.available_beds),
    [facilities],
  );

  async function runDispatch(emergencyId: string, hospitalId: string) {
    if (dispatching || isHistorical) return;
    setDispatching(true);
    let outcome;
    try {
      outcome = await processEmergencyRouting(emergencyId, hospitalId);
    } finally {
      setDispatching(false);
    }
    if (outcome.ok && outcome.result) {
      setRouting(outcome.result);
      toast.success(t("dispatch.success"), {
        description: `${t("dispatch.assignedPlate")}: ${outcome.result.assigned_ambulance_plate ?? "—"}`,
      });
      setSelectedHospital("");
      refresh();
      return;
    }
    const map: Record<string, string> = {
      NO_AVAILABLE_AMBULANCE: t("dispatch.noAmbulance"),
      EMERGENCY_NOT_ACTIVE: t("dispatch.notActive"),
      NOT_FOUND: t("dispatch.notFound"),
      NETWORK: t("dispatch.network"),
      VALIDATION: t("dispatch.validation"),
    };
    toast.error(t("dispatch.failure"), { description: map[outcome.code ?? "VALIDATION"] });
    refresh();
  }

  async function loadHistory() {
    if (!historyInput) return;
    try {
      const snap = await getHistoricalSnapshot(new Date(historyInput));
      setHistorical(snap);
      setRouting(null);
      if (snap.facilities.length === 0 && snap.ambulances.length === 0) {
        toast.info(t("history.empty"));
      }
    } catch {
      toast.error(t("history.error"));
    }
  }

  const activeFilterCount = countActiveFilters(filters);

  return (
    <div dir={dir} className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-[900] border-b border-border bg-navy text-navy-foreground">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-extrabold sm:text-lg">{t("app.title")}</h1>
            <p className="text-xs opacity-70">{t("app.subtitle")}</p>
          </div>
          <span
            className="inline-flex items-center gap-2 rounded-full bg-navy-2 px-3 py-1 text-xs font-semibold"
            aria-label={t("rt.label")}
          >
            <span
              className={`size-2 rounded-full ${
                rtStatus === "connected"
                  ? "bg-ok"
                  : rtStatus === "disconnected"
                    ? "bg-critical"
                    : "bg-warn"
              }`}
            />
            {t(`rt.${rtStatus}`)}
          </span>
          <Badge variant={isHistorical ? "secondary" : "default"}>
            {isHistorical ? t("mode.historical") : t("mode.live")}
          </Badge>
          <Button
            size="sm"
            variant="secondary"
            aria-label={t("sim.label")}
            title={t("sim.label")}
            onClick={async () => {
              const next = !simOn;
              setSimEnabled(next);
              const ok = await setSimulatorEnabled(next);
              if (!ok) setSimEnabled(!next);
              void simQuery.refetch();
            }}
          >
            <span
              className={`me-2 inline-block size-2 rounded-full ${simOn ? "bg-ok" : "bg-muted-foreground"}`}
            />
            {simOn ? t("sim.pause") : t("sim.resume")}
          </Button>
          <Button size="sm" variant="secondary" onClick={toggle} aria-label={t("lang.label")}>
            {t("lang.switch")}
          </Button>
        </div>
      </header>

      {isHistorical && (
        <div className="border-b border-warn/40 bg-warn-soft px-4 py-2 text-sm text-warn-foreground">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3">
            <span>{t("mode.historicalBanner")}</span>
            <span className="font-semibold">
              {t("mode.snapshotAt")}: {formatDateTime(historical.timestamp)}
            </span>
            <Button size="sm" variant="outline" onClick={() => setHistorical(null)}>
              {t("mode.returnLive")}
            </Button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1800px] space-y-4 p-4">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label={t("kpi.facilities")} value={formatNumber(facilities.length)} />
          <Kpi
            label={t("kpi.availableBeds")}
            value={formatNumber(facilities.reduce((s, f) => s + f.available_beds, 0))}
            tone="ok"
          />
          <Kpi
            label={t("kpi.highOccupancy")}
            value={formatNumber(facilities.filter((f) => f.status === "RED").length)}
            tone="critical"
          />
          <Kpi
            label={t("kpi.availableAmbulances")}
            value={formatNumber(ambulances.filter((a) => a.status === "available").length)}
          />
          <Kpi
            label={t("kpi.activeEmergencies")}
            value={formatNumber(emergencies.filter((e) => e.status === "active").length)}
          />
          <Kpi
            label={t("kpi.unreadAlerts")}
            value={formatNumber(alerts.filter((a) => !a.is_read).length)}
          />
        </section>

        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <Input
            className="h-9 w-64"
            placeholder={t("filters.search")}
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            aria-label={t("filters.search")}
          />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.governorate}
            onChange={(e) => setFilters((f) => ({ ...f, governorate: e.target.value }))}
            aria-label={t("filters.governorate")}
          >
            <option value="all">{t("filters.all")}</option>
            {governorates.map((g) => (
              <option key={g} value={g}>
                {gov(g)}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.facilityStatus}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                facilityStatus: e.target.value as DashboardFilters["facilityStatus"],
              }))
            }
            aria-label={t("filters.facilityStatus")}
          >
            <option value="all">{t("filters.all")}</option>
            <option value="GREEN">{t("status.GREEN")}</option>
            <option value="RED">{t("status.RED")}</option>
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.ambulanceStatus}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                ambulanceStatus: e.target.value as DashboardFilters["ambulanceStatus"],
              }))
            }
            aria-label={t("filters.ambulanceStatus")}
          >
            <option value="all">{t("filters.all")}</option>
            <option value="available">{t("ambulance.available")}</option>
            <option value="busy">{t("ambulance.busy")}</option>
            <option value="out_of_service">{t("ambulance.out_of_service")}</option>
          </select>
          {activeFilterCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t("filters.clear")} ({formatNumber(activeFilterCount)})
            </Button>
          )}
          <div className="ms-auto flex items-center gap-2">
            <Input
              type="datetime-local"
              className="h-9 w-56"
              value={historyInput}
              onChange={(e) => setHistoryInput(e.target.value)}
              aria-label={t("history.pick")}
            />
            <Button size="sm" variant="outline" onClick={loadHistory} disabled={!historyInput}>
              {t("history.load")}
            </Button>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="h-[420px] xl:h-[640px]">
            <MapPanel
              facilities={shownFacilities}
              ambulances={shownAmbulances}
              emergencies={shownEmergencies}
              routing={routing}
              focus={focus}
              onSelect={({ kind, id }) => focusOn(kind, id)}
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-3 xl:h-[640px]">
            <Tabs defaultValue="emergencies" className="flex h-full flex-col">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="emergencies">{t("tab.emergencies")}</TabsTrigger>
                <TabsTrigger value="facilities">{t("tab.facilities")}</TabsTrigger>
                <TabsTrigger value="ambulances">{t("tab.ambulances")}</TabsTrigger>
                <TabsTrigger value="alerts">{t("tab.alerts")}</TabsTrigger>
              </TabsList>

              <TabsContent value="emergencies" className="ops-scroll mt-3 flex-1 space-y-2 overflow-auto">
                {shownEmergencies.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">{t("emergency.none")}</p>
                )}
                {shownEmergencies.map((e) => (
                  <div key={e.id} className="rounded-lg border border-border p-3">
                    <button
                      className="w-full text-start"
                      onClick={() => {
                        focusOn("emergency", e.id);
                        setSelectedEmergency(e.id);
                        setSelectedHospital("");
                      }}
                    >
                      <p className="text-sm font-bold">{e.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {gov(e.governorate)} · {t(`severity.${e.severity}`)} ·{" "}
                        {t(`estatus.${e.status}`)}
                      </p>
                    </button>
                    {selectedEmergency === e.id && e.status === "active" && !isHistorical && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          className="h-8 max-w-[220px] flex-1 rounded-md border border-input bg-background px-2 text-xs"
                          aria-label={t("dispatch.selectHospital")}
                          value={selectedHospital}
                          disabled={dispatching}
                          onChange={(ev) => setSelectedHospital(ev.target.value)}
                        >
                          <option value="" disabled>
                            {t("dispatch.selectHospital")}
                          </option>
                          {dispatchTargets.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} — {formatNumber(f.available_beds)} {t("common.beds")}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={dispatching || !selectedHospital}
                          onClick={() => void runDispatch(e.id, selectedHospital)}
                        >
                          {dispatching ? t("dispatch.processing") : t("dispatch.execute")}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="facilities" className="ops-scroll mt-3 flex-1 space-y-2 overflow-auto">
                {shownFacilities.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => focusOn("facility", f.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-start hover:bg-accent"
                  >
                    <span>
                      <span className="block text-sm font-bold">{f.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {gov(f.governorate)} · {t(`facility.${f.facility_type}`)}
                      </span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${
                        f.status === "RED"
                          ? "bg-critical-soft text-critical"
                          : "bg-ok-soft text-ok"
                      }`}
                    >
                      {formatNumber(f.occupancy_rate, { maximumFractionDigits: 2 })}%
                    </span>
                  </button>
                ))}
              </TabsContent>

              <TabsContent value="ambulances" className="ops-scroll mt-3 flex-1 space-y-2 overflow-auto">
                {shownAmbulances.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => focusOn("ambulance", a.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-start hover:bg-accent"
                  >
                    <span>
                      <span className="block text-sm font-bold">{a.plate_number}</span>
                      <span className="block text-xs text-muted-foreground">
                        {gov(a.governorate)} ·{" "}
                        {formatNumber(a.speed_kmh, { maximumFractionDigits: 1 })} {t("common.kmh")}
                      </span>
                    </span>
                    <Badge variant={a.status === "available" ? "default" : "secondary"}>
                      {t(`ambulance.${a.status}`)}
                    </Badge>
                  </button>
                ))}
              </TabsContent>

              <TabsContent value="alerts" className="ops-scroll mt-3 flex-1 space-y-2 overflow-auto">
                {alerts.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">{t("alerts.none")}</p>
                )}
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-lg border p-3 ${
                      a.is_read ? "border-border" : "border-critical/40 bg-critical-soft"
                    }`}
                  >
                    <p className="text-sm font-bold">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.message}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(a.created_at)}
                      </span>
                      {!a.is_read && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await markAlertRead(a.id);
                              refresh();
                            } catch {
                              toast.error(t("dispatch.network"));
                            }
                          }}
                        >
                          {t("alerts.markRead")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {routing?.success && (
          <section className="rounded-xl border border-gis/40 bg-gis-soft p-4">
            <p className="text-sm font-bold">{t("dispatch.result")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("path.label")}</p>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              <span>
                {t("dispatch.assignedPlate")}: <b>{routing.assigned_ambulance_plate}</b>
              </span>
              <span>
                {t("emergency.receivingHospital")}: <b>{routing.hospital_name}</b>
              </span>
              <span>
                {t("dispatch.distance")}:{" "}
                <b>
                  {formatDistance(routing.ambulance_to_emergency_distance_meters ?? 0, lang)}
                </b>
              </span>
            </div>
          </section>
        )}

        {dispatches.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-sm font-bold">{t("tab.panel")}</p>
            <ul className="space-y-2">
              {dispatches.slice(0, 6).map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <span>
                    {d.emergency_title} · {d.ambulance_plate_number} → {d.hospital_name}
                  </span>
                  {!d.completed_at && !isHistorical && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const ok = await completeDispatch(d.id);
                        if (!ok) toast.error(t("dispatch.failure"));
                        refresh();
                      }}
                    >
                      {t("dispatch.complete")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {query.isError && (
          <div className="rounded-xl border border-critical/40 bg-critical-soft p-4">
            <p className="text-sm font-semibold text-critical">{t("state.error")}</p>
            <Button size="sm" className="mt-2" onClick={refresh}>
              {t("state.retry")}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/services/supabase";
import type { RealtimeStatus } from "@/types/medical";

const WATCHED_TABLES = [
  "medical_facilities",
  "ambulances",
  "emergency_incidents",
  "dispatch_assignments",
  "alerts",
] as const;

interface Options {
  /** Disabled in Historical Mode so the map never mixes live and past data. */
  enabled: boolean;
  /** Called (debounced) whenever any watched table changes. */
  onChange: () => void;
}

/**
 * One shared channel for the whole dashboard. Postgres changes are used only
 * as an invalidation signal — the authoritative state is re-read from the
 * database views, which keeps the UI consistent after any reconnection.
 */
export function useMedicalRealtime({ enabled, onChange }: Options) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) {
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let hasConnected = false;

    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => onChangeRef.current(), 220);
    };

    let channel = supabase.channel("medical-ops");
    for (const table of WATCHED_TABLES) {
      channel = (
        channel as unknown as {
          on: (
            event: string,
            filter: Record<string, string>,
            cb: () => void,
          ) => typeof channel;
        }
      ).on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }

    channel.subscribe((state: string) => {
      if (state === "SUBSCRIBED") {
        setStatus("connected");
        // Full resync after every (re)connection.
        if (hasConnected) onChangeRef.current();
        hasConnected = true;
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        setStatus("reconnecting");
      } else if (state === "CLOSED") {
        setStatus("disconnected");
      }
    });

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return status;
}
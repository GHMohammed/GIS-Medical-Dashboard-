CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE TABLE IF NOT EXISTS public.simulator_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  last_tick_at timestamptz,
  tick_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.simulator_settings TO anon, authenticated;
GRANT ALL ON public.simulator_settings TO service_role;
ALTER TABLE public.simulator_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PoC public read simulator settings" ON public.simulator_settings;
CREATE POLICY "PoC public read simulator settings"
  ON public.simulator_settings FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.simulator_settings (id, enabled) VALUES (true, true)
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.simulate_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_moved int := 0;
  v_facility record;
  v_delta int;
  v_new_occupied int;
  v_seed_facility record;
  v_dispatch record;
  v_titles text[] := ARRAY[
    'حادث سير على الطريق العام',
    'إصابة عمل في موقع بناء',
    'حالة اختناق تنفسي',
    'نزيف حاد يحتاج إسعاف',
    'إغماء في مكان عام',
    'حريق منزلي مع إصابات'
  ];
  v_sev emergency_severity;
BEGIN
  SELECT enabled INTO v_enabled FROM public.simulator_settings WHERE id;
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  -- 1. Move every in-service ambulance a small random step.
  WITH moved AS (
    UPDATE public.ambulances a
    SET
      current_location = ST_SetSRID(
        ST_MakePoint(
          LEAST(42.0, GREATEST(35.6, ST_X(a.current_location::geometry) + (random() - 0.5) * 0.02)),
          LEAST(37.3, GREATEST(32.3, ST_Y(a.current_location::geometry) + (random() - 0.5) * 0.02))
        ), 4326)::geography,
      heading_degrees = round((random() * 360)::numeric, 1),
      speed_kmh = CASE
        WHEN a.status = 'busy' THEN round((45 + random() * 45)::numeric, 1)
        WHEN a.status = 'available' THEN round((random() * 25)::numeric, 1)
        ELSE 0
      END,
      updated_at = now()
    WHERE a.status <> 'out_of_service'
    RETURNING 1
  )
  SELECT count(*) INTO v_moved FROM moved;

  -- 2. Nudge occupancy on one random facility (trigger recomputes GREEN/RED).
  SELECT * INTO v_facility
  FROM public.medical_facilities
  ORDER BY random() LIMIT 1;

  IF FOUND THEN
    v_delta := (floor(random() * 7) - 3)::int;  -- -3 .. +3
    v_new_occupied := GREATEST(0, LEAST(v_facility.total_beds, v_facility.occupied_beds + v_delta));
    IF v_new_occupied <> v_facility.occupied_beds THEN
      UPDATE public.medical_facilities
      SET occupied_beds = v_new_occupied, updated_at = now()
      WHERE id = v_facility.id;
    END IF;
  END IF;

  -- 3. Occasionally spawn a new active emergency near a random facility.
  IF random() < 0.18 AND (SELECT count(*) FROM public.emergency_incidents WHERE status = 'active') < 8 THEN
    SELECT * INTO v_seed_facility FROM public.medical_facilities ORDER BY random() LIMIT 1;
    IF FOUND THEN
      v_sev := (ARRAY['low','medium','high','critical']::emergency_severity[])[1 + floor(random() * 4)::int];
      INSERT INTO public.emergency_incidents (title, description, severity, status, governorate, location)
      VALUES (
        v_titles[1 + floor(random() * array_length(v_titles, 1))::int],
        'بلاغ آلي من محاكي البيانات الحية',
        v_sev,
        'active',
        v_seed_facility.governorate,
        ST_SetSRID(
          ST_MakePoint(
            ST_X(v_seed_facility.location::geometry) + (random() - 0.5) * 0.08,
            ST_Y(v_seed_facility.location::geometry) + (random() - 0.5) * 0.08
          ), 4326)::geography
      );
    END IF;
  END IF;

  -- 4. Occasionally complete an older open dispatch (frees its ambulance).
  IF random() < 0.15 THEN
    SELECT id INTO v_dispatch
    FROM public.dispatch_assignments
    WHERE completed_at IS NULL AND assigned_at < now() - interval '45 seconds'
    ORDER BY assigned_at ASC LIMIT 1;
    IF FOUND THEN
      PERFORM public.complete_dispatch(v_dispatch.id);
    END IF;
  END IF;

  -- 5. Keep the demo database small.
  DELETE FROM public.ambulance_location_history WHERE recorded_at < now() - interval '2 hours';
  DELETE FROM public.facility_occupancy_history WHERE recorded_at < now() - interval '2 hours';
  DELETE FROM public.alerts a
  WHERE a.created_at < now() - interval '2 hours'
    AND a.id NOT IN (SELECT id FROM public.alerts ORDER BY created_at DESC LIMIT 60);

  UPDATE public.simulator_settings
  SET last_tick_at = now(), tick_count = tick_count + 1, updated_at = now()
  WHERE id;

  RETURN jsonb_build_object('ok', true, 'ambulances_moved', v_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.simulate_tick() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulate_tick() TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.set_simulator_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.simulator_settings (id, enabled, updated_at)
  VALUES (true, p_enabled, now())
  ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  RETURN p_enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_simulator_enabled(boolean) TO anon, authenticated, service_role;

-- Run the simulator every 5 seconds.
DO $$
BEGIN
  PERFORM cron.unschedule('syria-gis-simulator');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule('syria-gis-simulator', '5 seconds', $$SELECT public.simulate_tick();$$);
CREATE OR REPLACE FUNCTION public.process_emergency_routing(
  p_hospital_id uuid,
  p_emergency_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_total_beds INTEGER;
    v_occupied_beds INTEGER;
    v_available_beds INTEGER;
    v_occupancy_rate NUMERIC(5,2);
    v_hospital_status facility_status;
    v_hospital_location GEOGRAPHY(POINT, 4326);
    v_hospital_name TEXT;
    v_emergency_location GEOGRAPHY(POINT, 4326);
    v_emergency_status emergency_status;
    v_candidate UUID;
    v_ambulance_id UUID;
    v_ambulance_plate TEXT;
    v_ambulance_location GEOGRAPHY(POINT, 4326);
    v_ambulance_distance NUMERIC(12,2);
    v_hospital_distance NUMERIC(12,2);
    v_dispatch_id UUID;
    v_alert_triggered BOOLEAN := FALSE;
BEGIN
    SELECT status, location INTO v_emergency_status, v_emergency_location
    FROM emergency_incidents WHERE id = p_emergency_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Emergency incident % does not exist', p_emergency_id;
    END IF;

    IF v_emergency_status <> 'active' THEN
        RAISE EXCEPTION 'Emergency incident % is not active', p_emergency_id;
    END IF;

    SELECT total_beds, occupied_beds, status, location, name
    INTO v_total_beds, v_occupied_beds, v_hospital_status, v_hospital_location, v_hospital_name
    FROM medical_facilities WHERE id = p_hospital_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Medical facility % does not exist', p_hospital_id;
    END IF;

    IF v_total_beds <= 0 THEN
        RAISE EXCEPTION 'Medical facility % has invalid total_beds', p_hospital_id;
    END IF;

    v_available_beds := v_total_beds - v_occupied_beds;
    v_occupancy_rate := ROUND((v_occupied_beds::NUMERIC / NULLIF(v_total_beds, 0)) * 100, 2);
    v_hospital_status := CASE WHEN v_occupancy_rate > 90 THEN 'RED'::facility_status ELSE 'GREEN'::facility_status END;

    UPDATE medical_facilities SET status = v_hospital_status WHERE id = p_hospital_id;

    IF v_hospital_status = 'RED' THEN
        v_alert_triggered := TRUE;
    END IF;

    -- Shortlist the nearest available ambulances WITHOUT locking. Locking rows
    -- straight out of a KNN index scan raises "attempted to lock invisible
    -- tuple" whenever a concurrent update (live position feed) touches a
    -- candidate row. We therefore re-read and lock each candidate by primary
    -- key, taking the first one that is still available.
    FOR v_candidate IN
        SELECT a.id
        FROM ambulances a
        WHERE a.status = 'available'
        ORDER BY a.current_location OPERATOR(public.<->) v_emergency_location
        LIMIT 10
    LOOP
        SELECT a.id, a.plate_number, a.current_location
        INTO v_ambulance_id, v_ambulance_plate, v_ambulance_location
        FROM ambulances a
        WHERE a.id = v_candidate AND a.status = 'available'
        FOR UPDATE SKIP LOCKED;

        EXIT WHEN v_ambulance_id IS NOT NULL;
    END LOOP;

    IF v_ambulance_id IS NULL THEN
        INSERT INTO alerts (alert_type, severity, title, message, facility_id, emergency_id)
        VALUES ('no_ambulance_available', 'critical', 'No ambulance available',
                'No available ambulance could be assigned to the emergency.', p_hospital_id, p_emergency_id);

        RETURN jsonb_build_object(
            'success', FALSE,
            'reason', 'NO_AVAILABLE_AMBULANCE',
            'emergency_id', p_emergency_id,
            'hospital_id', p_hospital_id,
            'hospital_name', v_hospital_name,
            'hospital_status', v_hospital_status,
            'alert_triggered', v_alert_triggered,
            'available_beds', v_available_beds,
            'occupancy_rate', v_occupancy_rate,
            'assigned_ambulance_id', NULL,
            'assigned_ambulance_plate', NULL,
            'ambulance_to_emergency_distance_meters', NULL,
            'emergency_to_hospital_distance_meters', NULL
        );
    END IF;

    -- Distances are measured from the confirmed, locked position.
    v_ambulance_distance := ROUND(ST_Distance(v_ambulance_location, v_emergency_location)::NUMERIC, 2);
    v_hospital_distance := ROUND(ST_Distance(v_emergency_location, v_hospital_location)::NUMERIC, 2);

    UPDATE ambulances SET status = 'busy' WHERE id = v_ambulance_id;

    INSERT INTO dispatch_assignments (
        emergency_id, hospital_id, ambulance_id,
        ambulance_to_emergency_distance_meters, emergency_to_hospital_distance_meters,
        hospital_occupancy_rate, hospital_status
    ) VALUES (
        p_emergency_id, p_hospital_id, v_ambulance_id,
        v_ambulance_distance, v_hospital_distance, v_occupancy_rate, v_hospital_status
    ) RETURNING id INTO v_dispatch_id;

    UPDATE emergency_incidents SET status = 'dispatched' WHERE id = p_emergency_id;

    INSERT INTO alerts (alert_type, severity, title, message, facility_id, ambulance_id, emergency_id, dispatch_id)
    VALUES ('ambulance_dispatched', 'high', 'Ambulance dispatched',
        format('Ambulance %s was assigned at a straight-line distance of %s meters.', v_ambulance_plate, v_ambulance_distance),
        p_hospital_id, v_ambulance_id, p_emergency_id, v_dispatch_id);

    RETURN jsonb_build_object(
        'success', TRUE,
        'dispatch_id', v_dispatch_id,
        'emergency_id', p_emergency_id,
        'hospital_id', p_hospital_id,
        'hospital_name', v_hospital_name,
        'hospital_status', v_hospital_status,
        'alert_triggered', v_alert_triggered,
        'available_beds', v_available_beds,
        'occupancy_rate', v_occupancy_rate,
        'assigned_ambulance_id', v_ambulance_id,
        'assigned_ambulance_plate', v_ambulance_plate,
        'ambulance_to_emergency_distance_meters', v_ambulance_distance,
        'emergency_to_hospital_distance_meters', v_hospital_distance,
        'ambulance_location', jsonb_build_object(
            'longitude', ST_X(v_ambulance_location::geometry),
            'latitude', ST_Y(v_ambulance_location::geometry)),
        'emergency_location', jsonb_build_object(
            'longitude', ST_X(v_emergency_location::geometry),
            'latitude', ST_Y(v_emergency_location::geometry)),
        'hospital_location', jsonb_build_object(
            'longitude', ST_X(v_hospital_location::geometry),
            'latitude', ST_Y(v_hospital_location::geometry))
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.process_emergency_routing(uuid, uuid) TO anon, authenticated, service_role;
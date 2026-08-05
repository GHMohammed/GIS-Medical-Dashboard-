CREATE OR REPLACE VIEW medical_facilities_map WITH (security_invoker = true) AS
SELECT f.id, f.name, f.facility_type, f.governorate, f.total_beds, f.occupied_beds,
    (f.total_beds - f.occupied_beds) AS available_beds,
    ROUND((f.occupied_beds::NUMERIC / NULLIF(f.total_beds, 0)) * 100, 2) AS occupancy_rate,
    f.status, ST_X(f.location::geometry) AS longitude, ST_Y(f.location::geometry) AS latitude,
    f.created_at, f.updated_at
FROM medical_facilities f;

CREATE OR REPLACE VIEW ambulances_map WITH (security_invoker = true) AS
SELECT a.id, a.plate_number, a.governorate, a.status,
    ST_X(a.current_location::geometry) AS longitude, ST_Y(a.current_location::geometry) AS latitude,
    a.heading_degrees, a.speed_kmh, a.created_at, a.updated_at
FROM ambulances a;

CREATE OR REPLACE VIEW emergency_incidents_map WITH (security_invoker = true) AS
SELECT e.id, e.title, e.description, e.severity, e.status, e.governorate,
    ST_X(e.location::geometry) AS longitude, ST_Y(e.location::geometry) AS latitude,
    e.created_at, e.updated_at, e.resolved_at
FROM emergency_incidents e;

CREATE OR REPLACE VIEW dispatch_assignments_details WITH (security_invoker = true) AS
SELECT d.id, d.emergency_id, e.title AS emergency_title, e.severity AS emergency_severity, e.status AS emergency_status,
    ST_X(e.location::geometry) AS emergency_longitude, ST_Y(e.location::geometry) AS emergency_latitude,
    d.hospital_id, f.name AS hospital_name,
    ST_X(f.location::geometry) AS hospital_longitude, ST_Y(f.location::geometry) AS hospital_latitude,
    d.ambulance_id, a.plate_number AS ambulance_plate_number,
    ST_X(a.current_location::geometry) AS ambulance_longitude, ST_Y(a.current_location::geometry) AS ambulance_latitude,
    d.ambulance_to_emergency_distance_meters, d.emergency_to_hospital_distance_meters,
    d.hospital_occupancy_rate, d.hospital_status, d.assigned_at, d.completed_at, d.manually_overridden
FROM dispatch_assignments d
JOIN emergency_incidents e ON e.id = d.emergency_id
JOIN medical_facilities f ON f.id = d.hospital_id
JOIN ambulances a ON a.id = d.ambulance_id;

CREATE OR REPLACE FUNCTION process_emergency_routing(p_hospital_id UUID, p_emergency_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_total_beds INTEGER;
    v_occupied_beds INTEGER;
    v_available_beds INTEGER;
    v_occupancy_rate NUMERIC(5,2);
    v_hospital_status facility_status;
    v_hospital_location GEOGRAPHY(POINT, 4326);
    v_hospital_name TEXT;
    v_hospital_longitude DOUBLE PRECISION;
    v_hospital_latitude DOUBLE PRECISION;
    v_emergency_location GEOGRAPHY(POINT, 4326);
    v_emergency_status emergency_status;
    v_emergency_longitude DOUBLE PRECISION;
    v_emergency_latitude DOUBLE PRECISION;
    v_ambulance_id UUID;
    v_ambulance_plate TEXT;
    v_ambulance_location GEOGRAPHY(POINT, 4326);
    v_ambulance_longitude DOUBLE PRECISION;
    v_ambulance_latitude DOUBLE PRECISION;
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

    SELECT a.id, a.plate_number, a.current_location,
        ROUND(ST_Distance(a.current_location, v_emergency_location)::NUMERIC, 2)
    INTO v_ambulance_id, v_ambulance_plate, v_ambulance_location, v_ambulance_distance
    FROM ambulances a
    WHERE a.status = 'available'
    ORDER BY a.current_location <-> v_emergency_location
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

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

    v_ambulance_longitude := ST_X(v_ambulance_location::geometry);
    v_ambulance_latitude := ST_Y(v_ambulance_location::geometry);
    v_emergency_longitude := ST_X(v_emergency_location::geometry);
    v_emergency_latitude := ST_Y(v_emergency_location::geometry);
    v_hospital_longitude := ST_X(v_hospital_location::geometry);
    v_hospital_latitude := ST_Y(v_hospital_location::geometry);

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
        'ambulance_location', jsonb_build_object('longitude', v_ambulance_longitude, 'latitude', v_ambulance_latitude),
        'emergency_location', jsonb_build_object('longitude', v_emergency_longitude, 'latitude', v_emergency_latitude),
        'hospital_location', jsonb_build_object('longitude', v_hospital_longitude, 'latitude', v_hospital_latitude)
    );
END;
$$;

CREATE OR REPLACE FUNCTION complete_dispatch(p_dispatch_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_dispatch dispatch_assignments%ROWTYPE;
BEGIN
    SELECT * INTO v_dispatch FROM dispatch_assignments WHERE id = p_dispatch_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch % does not exist', p_dispatch_id;
    END IF;

    IF v_dispatch.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Dispatch % is already completed', p_dispatch_id;
    END IF;

    UPDATE dispatch_assignments SET completed_at = now() WHERE id = p_dispatch_id;
    UPDATE ambulances SET status = 'available', speed_kmh = 0 WHERE id = v_dispatch.ambulance_id;
    UPDATE emergency_incidents SET status = 'resolved', resolved_at = now() WHERE id = v_dispatch.emergency_id;

    INSERT INTO alerts (alert_type, severity, title, message, facility_id, ambulance_id, emergency_id, dispatch_id)
    VALUES ('dispatch_completed', 'low', 'Dispatch completed', 'The emergency dispatch was completed successfully.',
        v_dispatch.hospital_id, v_dispatch.ambulance_id, v_dispatch.emergency_id, v_dispatch.id);

    RETURN jsonb_build_object('success', TRUE, 'dispatch_id', v_dispatch.id,
        'emergency_id', v_dispatch.emergency_id, 'ambulance_id', v_dispatch.ambulance_id, 'completed_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION mark_alert_read(p_alert_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE alerts SET is_read = TRUE WHERE id = p_alert_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION get_historical_snapshot(p_timestamp TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
SELECT jsonb_build_object(
    'timestamp', p_timestamp,
    'ambulances', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'ambulance_id', h.ambulance_id,
            'plate_number', a.plate_number,
            'governorate', a.governorate,
            'status', h.status,
            'longitude', ST_X(h.location::geometry),
            'latitude', ST_Y(h.location::geometry),
            'heading_degrees', h.heading_degrees,
            'speed_kmh', h.speed_kmh,
            'recorded_at', h.recorded_at
        ) ORDER BY a.plate_number)
        FROM (
            SELECT DISTINCT ON (ambulance_id) ambulance_id, status, location, heading_degrees, speed_kmh, recorded_at
            FROM ambulance_location_history
            WHERE recorded_at <= p_timestamp
            ORDER BY ambulance_id, recorded_at DESC
        ) h
        JOIN ambulances a ON a.id = h.ambulance_id
    ), '[]'::jsonb),
    'facilities', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'facility_id', h.facility_id,
            'name', f.name,
            'facility_type', f.facility_type,
            'governorate', f.governorate,
            'longitude', ST_X(f.location::geometry),
            'latitude', ST_Y(f.location::geometry),
            'total_beds', h.total_beds,
            'occupied_beds', h.occupied_beds,
            'available_beds', h.available_beds,
            'occupancy_rate', h.occupancy_rate,
            'status', h.status,
            'recorded_at', h.recorded_at
        ) ORDER BY f.name)
        FROM (
            SELECT DISTINCT ON (facility_id) facility_id, total_beds, occupied_beds, available_beds, occupancy_rate, status, recorded_at
            FROM facility_occupancy_history
            WHERE recorded_at <= p_timestamp
            ORDER BY facility_id, recorded_at DESC
        ) h
        JOIN medical_facilities f ON f.id = h.facility_id
    ), '[]'::jsonb)
);
$$;

GRANT SELECT ON medical_facilities_map TO anon, authenticated;
GRANT SELECT ON ambulances_map TO anon, authenticated;
GRANT SELECT ON emergency_incidents_map TO anon, authenticated;
GRANT SELECT ON dispatch_assignments_details TO anon, authenticated;

GRANT EXECUTE ON FUNCTION process_emergency_routing(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_dispatch(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_alert_read(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_historical_snapshot(TIMESTAMPTZ) TO anon, authenticated;
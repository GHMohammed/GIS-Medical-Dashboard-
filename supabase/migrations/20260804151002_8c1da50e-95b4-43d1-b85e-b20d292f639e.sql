CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
    CREATE TYPE facility_type AS ENUM ('central_hospital','clinic','field_medical_point');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE facility_status AS ENUM ('GREEN', 'RED');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE ambulance_status AS ENUM ('available','busy','out_of_service');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE emergency_status AS ENUM ('active','dispatched','resolved','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE emergency_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE alert_type AS ENUM ('high_occupancy','emergency_created','ambulance_dispatched','no_ambulance_available','dispatch_completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS medical_facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    facility_type facility_type NOT NULL,
    governorate TEXT NOT NULL CHECK (char_length(trim(governorate)) > 0),
    total_beds INTEGER NOT NULL CHECK (total_beds > 0),
    occupied_beds INTEGER NOT NULL DEFAULT 0 CHECK (occupied_beds >= 0),
    status facility_status NOT NULL DEFAULT 'GREEN',
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medical_facilities_valid_bed_capacity CHECK (occupied_beds <= total_beds)
);

CREATE INDEX IF NOT EXISTS medical_facilities_location_gix ON medical_facilities USING GIST (location);
CREATE INDEX IF NOT EXISTS medical_facilities_governorate_idx ON medical_facilities (governorate);
CREATE INDEX IF NOT EXISTS medical_facilities_status_idx ON medical_facilities (status);
CREATE INDEX IF NOT EXISTS medical_facilities_type_idx ON medical_facilities (facility_type);

CREATE TABLE IF NOT EXISTS ambulances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_number TEXT NOT NULL UNIQUE CHECK (char_length(trim(plate_number)) > 0),
    governorate TEXT NOT NULL CHECK (char_length(trim(governorate)) > 0),
    status ambulance_status NOT NULL DEFAULT 'available',
    current_location GEOGRAPHY(POINT, 4326) NOT NULL,
    heading_degrees NUMERIC(6,2) CHECK (heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees < 360)),
    speed_kmh NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (speed_kmh >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambulances_location_gix ON ambulances USING GIST (current_location);
CREATE INDEX IF NOT EXISTS ambulances_status_idx ON ambulances (status);
CREATE INDEX IF NOT EXISTS ambulances_governorate_idx ON ambulances (governorate);

CREATE TABLE IF NOT EXISTS emergency_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    description TEXT,
    severity emergency_severity NOT NULL DEFAULT 'medium',
    status emergency_status NOT NULL DEFAULT 'active',
    governorate TEXT NOT NULL CHECK (char_length(trim(governorate)) > 0),
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT emergency_resolved_at_consistency CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS emergency_incidents_location_gix ON emergency_incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS emergency_incidents_status_idx ON emergency_incidents (status);
CREATE INDEX IF NOT EXISTS emergency_incidents_severity_idx ON emergency_incidents (severity);
CREATE INDEX IF NOT EXISTS emergency_incidents_created_at_idx ON emergency_incidents (created_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emergency_id UUID NOT NULL REFERENCES emergency_incidents(id) ON DELETE RESTRICT,
    hospital_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE RESTRICT,
    ambulance_id UUID NOT NULL REFERENCES ambulances(id) ON DELETE RESTRICT,
    ambulance_to_emergency_distance_meters NUMERIC(12,2) NOT NULL CHECK (ambulance_to_emergency_distance_meters >= 0),
    emergency_to_hospital_distance_meters NUMERIC(12,2) NOT NULL CHECK (emergency_to_hospital_distance_meters >= 0),
    hospital_occupancy_rate NUMERIC(5,2) NOT NULL CHECK (hospital_occupancy_rate BETWEEN 0 AND 100),
    hospital_status facility_status NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    manually_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT dispatch_completion_consistency CHECK (completed_at IS NULL OR completed_at >= assigned_at)
);

CREATE INDEX IF NOT EXISTS dispatch_assignments_emergency_idx ON dispatch_assignments (emergency_id);
CREATE INDEX IF NOT EXISTS dispatch_assignments_ambulance_idx ON dispatch_assignments (ambulance_id);
CREATE INDEX IF NOT EXISTS dispatch_assignments_hospital_idx ON dispatch_assignments (hospital_id);
CREATE INDEX IF NOT EXISTS dispatch_assignments_assigned_at_idx ON dispatch_assignments (assigned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_one_active_assignment_per_emergency ON dispatch_assignments (emergency_id) WHERE completed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_one_active_assignment_per_ambulance ON dispatch_assignments (ambulance_id) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type alert_type NOT NULL,
    severity emergency_severity NOT NULL DEFAULT 'high',
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    message TEXT NOT NULL CHECK (char_length(trim(message)) > 0),
    facility_id UUID REFERENCES medical_facilities(id) ON DELETE SET NULL,
    ambulance_id UUID REFERENCES ambulances(id) ON DELETE SET NULL,
    emergency_id UUID REFERENCES emergency_incidents(id) ON DELETE SET NULL,
    dispatch_id UUID REFERENCES dispatch_assignments(id) ON DELETE SET NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_is_read_idx ON alerts (is_read);
CREATE INDEX IF NOT EXISTS alerts_emergency_idx ON alerts (emergency_id);
CREATE INDEX IF NOT EXISTS alerts_facility_idx ON alerts (facility_id);

CREATE TABLE IF NOT EXISTS ambulance_location_history (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ambulance_id UUID NOT NULL REFERENCES ambulances(id) ON DELETE CASCADE,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    status ambulance_status NOT NULL,
    heading_degrees NUMERIC(6,2),
    speed_kmh NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (speed_kmh >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambulance_history_location_gix ON ambulance_location_history USING GIST (location);
CREATE INDEX IF NOT EXISTS ambulance_history_entity_time_idx ON ambulance_location_history (ambulance_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ambulance_history_recorded_at_idx ON ambulance_location_history (recorded_at DESC);

CREATE TABLE IF NOT EXISTS facility_occupancy_history (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    facility_id UUID NOT NULL REFERENCES medical_facilities(id) ON DELETE CASCADE,
    total_beds INTEGER NOT NULL CHECK (total_beds > 0),
    occupied_beds INTEGER NOT NULL CHECK (occupied_beds >= 0),
    available_beds INTEGER NOT NULL CHECK (available_beds >= 0),
    occupancy_rate NUMERIC(5,2) NOT NULL CHECK (occupancy_rate BETWEEN 0 AND 100),
    status facility_status NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT facility_history_valid_beds CHECK (occupied_beds <= total_beds),
    CONSTRAINT facility_history_available_beds CHECK (available_beds = total_beds - occupied_beds)
);

CREATE INDEX IF NOT EXISTS facility_history_entity_time_idx ON facility_occupancy_history (facility_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS facility_history_recorded_at_idx ON facility_occupancy_history (recorded_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medical_facilities_set_updated_at ON medical_facilities;
CREATE TRIGGER medical_facilities_set_updated_at BEFORE UPDATE ON medical_facilities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS ambulances_set_updated_at ON ambulances;
CREATE TRIGGER ambulances_set_updated_at BEFORE UPDATE ON ambulances FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS emergency_incidents_set_updated_at ON emergency_incidents;
CREATE TRIGGER emergency_incidents_set_updated_at BEFORE UPDATE ON emergency_incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION calculate_facility_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_occupancy_rate NUMERIC(5,2);
BEGIN
    v_occupancy_rate := ROUND((NEW.occupied_beds::NUMERIC / NULLIF(NEW.total_beds, 0)) * 100, 2);
    NEW.status := CASE WHEN v_occupancy_rate > 90 THEN 'RED'::facility_status ELSE 'GREEN'::facility_status END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medical_facilities_calculate_status ON medical_facilities;
CREATE TRIGGER medical_facilities_calculate_status BEFORE INSERT OR UPDATE OF total_beds, occupied_beds ON medical_facilities FOR EACH ROW EXECUTE FUNCTION calculate_facility_status();

CREATE OR REPLACE FUNCTION alert_on_high_occupancy()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_rate NUMERIC(5,2);
BEGIN
    IF NEW.status = 'RED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'RED'::facility_status) THEN
        v_rate := ROUND((NEW.occupied_beds::NUMERIC / NULLIF(NEW.total_beds, 0)) * 100, 2);
        INSERT INTO alerts (alert_type, severity, title, message, facility_id)
        VALUES ('high_occupancy', 'critical', 'Hospital occupancy above 90%', format('Facility occupancy reached %s%%', v_rate), NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medical_facilities_alert_high_occupancy ON medical_facilities;
CREATE TRIGGER medical_facilities_alert_high_occupancy AFTER INSERT OR UPDATE OF total_beds, occupied_beds ON medical_facilities FOR EACH ROW EXECUTE FUNCTION alert_on_high_occupancy();

CREATE OR REPLACE FUNCTION record_ambulance_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT'
       OR NEW.current_location IS DISTINCT FROM OLD.current_location
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.heading_degrees IS DISTINCT FROM OLD.heading_degrees
       OR NEW.speed_kmh IS DISTINCT FROM OLD.speed_kmh
    THEN
        INSERT INTO ambulance_location_history (ambulance_id, location, status, heading_degrees, speed_kmh, recorded_at)
        VALUES (NEW.id, NEW.current_location, NEW.status, NEW.heading_degrees, NEW.speed_kmh, now());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ambulances_record_history ON ambulances;
CREATE TRIGGER ambulances_record_history AFTER INSERT OR UPDATE ON ambulances FOR EACH ROW EXECUTE FUNCTION record_ambulance_history();

CREATE OR REPLACE FUNCTION record_facility_occupancy_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_available_beds INTEGER;
    v_occupancy_rate NUMERIC(5,2);
BEGIN
    IF TG_OP = 'INSERT'
       OR NEW.total_beds IS DISTINCT FROM OLD.total_beds
       OR NEW.occupied_beds IS DISTINCT FROM OLD.occupied_beds
       OR NEW.status IS DISTINCT FROM OLD.status
    THEN
        v_available_beds := NEW.total_beds - NEW.occupied_beds;
        v_occupancy_rate := ROUND((NEW.occupied_beds::NUMERIC / NULLIF(NEW.total_beds, 0)) * 100, 2);
        INSERT INTO facility_occupancy_history (facility_id, total_beds, occupied_beds, available_beds, occupancy_rate, status, recorded_at)
        VALUES (NEW.id, NEW.total_beds, NEW.occupied_beds, v_available_beds, v_occupancy_rate, NEW.status, now());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facilities_record_occupancy_history ON medical_facilities;
CREATE TRIGGER facilities_record_occupancy_history AFTER INSERT OR UPDATE ON medical_facilities FOR EACH ROW EXECUTE FUNCTION record_facility_occupancy_history();

CREATE OR REPLACE FUNCTION alert_on_emergency_created()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    INSERT INTO alerts (alert_type, severity, title, message, emergency_id)
    VALUES ('emergency_created', NEW.severity, 'New emergency incident', NEW.title, NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emergency_incidents_create_alert ON emergency_incidents;
CREATE TRIGGER emergency_incidents_create_alert AFTER INSERT ON emergency_incidents FOR EACH ROW EXECUTE FUNCTION alert_on_emergency_created();

GRANT SELECT ON medical_facilities, ambulances, emergency_incidents, dispatch_assignments, alerts, ambulance_location_history, facility_occupancy_history TO anon, authenticated;
GRANT ALL ON medical_facilities, ambulances, emergency_incidents, dispatch_assignments, alerts, ambulance_location_history, facility_occupancy_history TO service_role;

ALTER TABLE medical_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ambulances ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ambulance_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_occupancy_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PoC public read medical facilities" ON medical_facilities;
CREATE POLICY "PoC public read medical facilities" ON medical_facilities FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "PoC public read ambulances" ON ambulances;
CREATE POLICY "PoC public read ambulances" ON ambulances FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "PoC public read emergencies" ON emergency_incidents;
CREATE POLICY "PoC public read emergencies" ON emergency_incidents FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "PoC public read dispatches" ON dispatch_assignments;
CREATE POLICY "PoC public read dispatches" ON dispatch_assignments FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "PoC public read alerts" ON alerts;
CREATE POLICY "PoC public read alerts" ON alerts FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "PoC public read ambulance history" ON ambulance_location_history;
CREATE POLICY "PoC public read ambulance history" ON ambulance_location_history FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "PoC public read facility history" ON facility_occupancy_history;
CREATE POLICY "PoC public read facility history" ON facility_occupancy_history FOR SELECT TO anon, authenticated USING (TRUE);

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['medical_facilities','ambulances','emergency_incidents','dispatch_assignments','alerts']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
        END IF;
    END LOOP;
END
$$;
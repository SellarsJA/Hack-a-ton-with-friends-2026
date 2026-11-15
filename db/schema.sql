create table if not exists stops (stop_id text primary key, name text not null, lat float8 not null, lon float8 not null, zone text);
create index if not exists stops_lat_lon on stops (lat, lon);
create table if not exists routes (route_id text primary key, agency_id text not null, short_name text, long_name text, route_type int not null, color text);
create table if not exists trips (trip_id text primary key, route_id text not null, service_id text not null, headsign text, shape_id text);
create index if not exists trips_service on trips (service_id);
create table if not exists service_dates (service_id text not null, date date not null, primary key (service_id, date));
create table if not exists stop_times (trip_id text not null, stop_sequence int not null, stop_id text not null, arr int not null, dep int not null, primary key (trip_id, stop_sequence));
create index if not exists stop_times_stop_dep on stop_times (stop_id, dep);
create table if not exists shapes (shape_id text primary key, points jsonb not null); -- [[lat,lon],...], 5 decimals
create table if not exists feed_meta (feed_version text, window_start date, window_end date, imported_at timestamptz default now());

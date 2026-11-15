create table stops (stop_id text primary key, name text not null, lat float8 not null, lon float8 not null, zone text);
create index stops_lat_lon on stops (lat, lon);
create table routes (route_id text primary key, agency_id text not null, short_name text, long_name text, route_type int not null, color text);
create table trips (trip_id text primary key, route_id text not null, service_id text not null, headsign text, shape_id text);
create index trips_service on trips (service_id);
create table service_dates (service_id text not null, date date not null, primary key (service_id, date));
create table stop_times (trip_id text not null, stop_sequence int not null, stop_id text not null, arr int not null, dep int not null, primary key (trip_id, stop_sequence));
create index stop_times_stop_dep on stop_times (stop_id, dep);
create table shapes (shape_id text primary key, points jsonb not null); -- [[lat,lon],...], 5 decimals
create table feed_meta (feed_version text, window_start date, window_end date, imported_at timestamptz default now());

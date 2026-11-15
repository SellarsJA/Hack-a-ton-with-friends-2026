create table if not exists profiles (id uuid primary key, created_at timestamptz not null default now(), last_seen_at timestamptz not null default now());
create table if not exists feedback (
  profile_id uuid not null references profiles(id), ride_key text not null,
  vehicle_label text, route_id text not null, trip_id text not null, service_date date not null,
  stars smallint check (stars between 1 and 5), accuracy jsonb not null default '{}'::jsonb,
  issue text check (issue in ('cleanliness','safety','disruption','too_full')), note text check (length(note) <= 500),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (profile_id, ride_key));
create index if not exists feedback_vehicle on feedback (vehicle_label, updated_at);
create table if not exists predictions (
  trip_id text not null, service_date date not null, stop_id text not null, stop_sequence int not null,
  scheduled_epoch bigint not null, predicted_epoch bigint not null, predicted_at bigint not null, realtime boolean not null,
  latest_epoch bigint, latest_at bigint, final boolean not null default false,
  primary key (trip_id, service_date, stop_sequence, predicted_at));
create index if not exists predictions_open on predictions (final) where not final;

create extension if not exists pgcrypto;

create type public.app_role as enum ('neighbor', 'driver', 'admin');
create type public.run_status as enum ('scheduled', 'active', 'paused', 'completed');

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  zone text not null,
  schedule_text text,
  starts_at time,
  ends_at time,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  unit_number text not null unique,
  plate text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'neighbor',
  full_name text not null default '',
  address text,
  home_lat double precision check (home_lat between -90 and 90),
  home_lng double precision check (home_lng between -180 and 180),
  route_id uuid references public.routes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  name text not null,
  stop_order integer not null check (stop_order > 0),
  estimated_time time,
  lat double precision,
  lng double precision,
  unique (route_id, stop_order)
);

create table public.route_runs (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id),
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid not null references public.profiles(id),
  status public.run_status not null default 'scheduled',
  service_date date not null default current_date,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index one_open_run_per_vehicle
  on public.route_runs(vehicle_id)
  where status in ('active', 'paused');

create table public.vehicle_locations (
  run_id uuid primary key references public.route_runs(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  recorded_at timestamptz not null default now()
);

create table public.notification_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  alert_radius_m integer not null default 400 check (alert_radius_m between 100 and 5000),
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  run_id uuid references public.route_runs(id) on delete cascade,
  kind text not null default 'proximity',
  title text not null,
  body text not null,
  distance_m integer,
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, run_id, kind)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare default_route uuid;
begin
  select id into default_route from public.routes where active order by created_at limit 1;
  insert into public.profiles (id, full_name, route_id)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), default_route);
  insert into public.notification_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_driver_or_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('driver', 'admin')
  );
$$;

alter table public.routes enable row level security;
alter table public.vehicles enable row level security;
alter table public.profiles enable row level security;
alter table public.route_stops enable row level security;
alter table public.route_runs enable row level security;
alter table public.vehicle_locations enable row level security;
alter table public.notification_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.alerts enable row level security;

create policy "authenticated users read routes" on public.routes for select to authenticated using (true);
create policy "authenticated users read vehicles" on public.vehicles for select to authenticated using (true);
create policy "authenticated users read stops" on public.route_stops for select to authenticated using (true);

create policy "users read own profile" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_driver_or_admin());
create policy "users update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "authenticated users read runs" on public.route_runs for select to authenticated using (true);
create policy "drivers create own runs" on public.route_runs for insert to authenticated
  with check (driver_id = auth.uid() and public.is_driver_or_admin());
create policy "drivers update own runs" on public.route_runs for update to authenticated
  using (driver_id = auth.uid() and public.is_driver_or_admin())
  with check (driver_id = auth.uid() and public.is_driver_or_admin());

create policy "authenticated users read locations" on public.vehicle_locations for select to authenticated using (true);
create policy "drivers publish own location" on public.vehicle_locations for insert to authenticated
  with check (exists (select 1 from public.route_runs r where r.id = run_id and r.driver_id = auth.uid()) and public.is_driver_or_admin());
create policy "drivers update own location" on public.vehicle_locations for update to authenticated
  using (exists (select 1 from public.route_runs r where r.id = run_id and r.driver_id = auth.uid()) and public.is_driver_or_admin())
  with check (exists (select 1 from public.route_runs r where r.id = run_id and r.driver_id = auth.uid()) and public.is_driver_or_admin());

create policy "users read own notification settings" on public.notification_settings for select to authenticated using (user_id = auth.uid());
create policy "users update own notification settings" on public.notification_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users manage own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users read own alerts" on public.alerts for select to authenticated using (user_id = auth.uid());
create policy "users mark own alerts read" on public.alerts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (full_name, address, home_lat, home_lng, route_id, updated_at) on public.profiles to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.route_runs, public.vehicle_locations to authenticated;
grant update on public.notification_settings to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;
grant update (read_at) on public.alerts to authenticated;

insert into public.routes (id, name, code, zone, schedule_text, starts_at, ends_at)
values ('11111111-1111-4111-8111-111111111111', 'Zona Norte · Circuito B', 'RN-04', 'Zona Norte', 'Martes, jueves y sábados', '07:00', '09:20');

insert into public.vehicles (id, unit_number, plate, description)
values ('22222222-2222-4222-8222-222222222222', '07', 'AB 123 CD', 'Camión compactador');

insert into public.route_stops (route_id, name, stop_order, estimated_time) values
  ('11111111-1111-4111-8111-111111111111', 'Base Municipal', 1, '07:00'),
  ('11111111-1111-4111-8111-111111111111', 'Av. San Martín', 2, '07:18'),
  ('11111111-1111-4111-8111-111111111111', 'Plaza del Encuentro', 3, '07:35'),
  ('11111111-1111-4111-8111-111111111111', 'Barrio Los Aromos', 4, '07:52'),
  ('11111111-1111-4111-8111-111111111111', 'Escuela N° 12', 5, '08:10');

do $$
begin
  alter publication supabase_realtime add table public.route_runs;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.vehicle_locations;
exception when duplicate_object then null;
end $$;


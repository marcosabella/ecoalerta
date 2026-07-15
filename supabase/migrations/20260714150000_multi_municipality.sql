alter type public.app_role add value if not exists 'platform_admin';
alter type public.app_role add value if not exists 'municipal_admin';

create table public.municipalities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  locality text not null,
  province text,
  contact_email text,
  logo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.municipalities (id, name, slug, locality, province, contact_email)
values ('00000000-0000-4000-8000-000000000001', 'Municipio Demo EcoAlerta', 'demo-ecoalerta', 'Localidad Demo', 'Buenos Aires', 'municipio@ecoalerta.ar');

alter table public.profiles add column municipality_id uuid references public.municipalities(id) on delete set null;
alter table public.routes add column municipality_id uuid references public.municipalities(id) on delete cascade;
alter table public.vehicles add column municipality_id uuid references public.municipalities(id) on delete cascade;
alter table public.route_runs add column municipality_id uuid references public.municipalities(id) on delete cascade;

alter table public.routes drop constraint if exists routes_code_key;
alter table public.vehicles drop constraint if exists vehicles_unit_number_key;

update public.routes set municipality_id = '00000000-0000-4000-8000-000000000001' where municipality_id is null;
update public.vehicles set municipality_id = '00000000-0000-4000-8000-000000000001' where municipality_id is null;
update public.route_runs r set municipality_id = rt.municipality_id from public.routes rt where r.route_id = rt.id and r.municipality_id is null;
update public.profiles p set municipality_id = r.municipality_id from public.routes r where p.route_id = r.id and p.municipality_id is null;

alter table public.routes alter column municipality_id set not null;
alter table public.vehicles alter column municipality_id set not null;
alter table public.route_runs alter column municipality_id set not null;
alter table public.routes add constraint routes_municipality_code_key unique (municipality_id, code);
alter table public.vehicles add constraint vehicles_municipality_unit_key unique (municipality_id, unit_number);

create index profiles_municipality_idx on public.profiles(municipality_id);
create index routes_municipality_idx on public.routes(municipality_id);
create index vehicles_municipality_idx on public.vehicles(municipality_id);
create index runs_municipality_idx on public.route_runs(municipality_id);

create table public.route_assignments (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_id uuid references public.profiles(id) on delete set null,
  weekdays integer[] not null default array[2,4,6],
  active boolean not null default true,
  valid_from date not null default current_date,
  valid_until date,
  created_at timestamptz not null default now(),
  unique (route_id, vehicle_id, valid_from)
);

insert into public.route_assignments (municipality_id, route_id, vehicle_id)
values (
  '00000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  insert into public.notification_settings (user_id) values (new.id);
  return new;
end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role::text in ('admin', 'platform_admin')
  );
$$;

create or replace function public.current_municipality_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select municipality_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_municipal_admin(target_municipality uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role::text = 'municipal_admin'
      and municipality_id = target_municipality
  );
$$;

create or replace function public.is_driver_or_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role::text in ('driver', 'municipal_admin', 'admin', 'platform_admin')
  );
$$;

create or replace function public.select_municipality(target_municipality uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.municipalities where id = target_municipality and active) then
    raise exception 'Municipio inexistente o inactivo';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role::text = 'neighbor') then
    raise exception 'Solo los vecinos pueden seleccionar su municipio';
  end if;
  update public.profiles
  set municipality_id = target_municipality,
      route_id = null,
      updated_at = now()
  where id = auth.uid();
end;
$$;

create or replace function public.set_user_access(target_email text, new_role text, target_municipality uuid default null)
returns uuid
language plpgsql
security definer set search_path = public, auth
as $$
declare
  target_id uuid;
  caller_municipality uuid;
begin
  select id into target_id from auth.users where lower(email) = lower(target_email);
  if target_id is null then raise exception 'No existe un usuario con ese correo'; end if;

  if public.is_platform_admin() then
    if new_role not in ('neighbor', 'driver', 'municipal_admin', 'platform_admin') then raise exception 'Rol inválido'; end if;
    if new_role = 'platform_admin' then target_municipality := null; end if;
    if new_role <> 'platform_admin' and target_municipality is null then raise exception 'El rol requiere un municipio'; end if;
  else
    select municipality_id into caller_municipality from public.profiles where id = auth.uid() and role::text = 'municipal_admin';
    if caller_municipality is null or target_municipality is distinct from caller_municipality or new_role not in ('neighbor', 'driver') then
      raise exception 'No autorizado';
    end if;
  end if;

  update public.profiles
  set role = new_role::public.app_role,
      municipality_id = target_municipality,
      route_id = null,
      updated_at = now()
  where id = target_id;
  return target_id;
end;
$$;

alter table public.municipalities enable row level security;
alter table public.route_assignments enable row level security;

drop policy if exists "authenticated users read routes" on public.routes;
drop policy if exists "authenticated users read vehicles" on public.vehicles;
drop policy if exists "authenticated users read stops" on public.route_stops;
drop policy if exists "users read own profile" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
drop policy if exists "authenticated users read runs" on public.route_runs;
drop policy if exists "drivers create own runs" on public.route_runs;
drop policy if exists "drivers update own runs" on public.route_runs;
drop policy if exists "authenticated users read locations" on public.vehicle_locations;
drop policy if exists "drivers publish own location" on public.vehicle_locations;
drop policy if exists "drivers update own location" on public.vehicle_locations;
drop policy if exists "users read own alerts" on public.alerts;
drop policy if exists "users mark own alerts read" on public.alerts;

create policy "users list active municipalities" on public.municipalities for select to authenticated
  using (active or public.is_platform_admin());
create policy "platform admins create municipalities" on public.municipalities for insert to authenticated
  with check (public.is_platform_admin());
create policy "platform admins update municipalities" on public.municipalities for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins delete municipalities" on public.municipalities for delete to authenticated
  using (public.is_platform_admin());

create policy "tenant users read routes" on public.routes for select to authenticated
  using (public.is_platform_admin() or municipality_id = public.current_municipality_id());
create policy "tenant admins create routes" on public.routes for insert to authenticated
  with check (public.is_platform_admin() or public.is_municipal_admin(municipality_id));
create policy "tenant admins update routes" on public.routes for update to authenticated
  using (public.is_platform_admin() or public.is_municipal_admin(municipality_id))
  with check (public.is_platform_admin() or public.is_municipal_admin(municipality_id));
create policy "tenant admins delete routes" on public.routes for delete to authenticated
  using (public.is_platform_admin() or public.is_municipal_admin(municipality_id));

create policy "tenant users read vehicles" on public.vehicles for select to authenticated
  using (public.is_platform_admin() or municipality_id = public.current_municipality_id());
create policy "tenant admins create vehicles" on public.vehicles for insert to authenticated
  with check (public.is_platform_admin() or public.is_municipal_admin(municipality_id));
create policy "tenant admins update vehicles" on public.vehicles for update to authenticated
  using (public.is_platform_admin() or public.is_municipal_admin(municipality_id))
  with check (public.is_platform_admin() or public.is_municipal_admin(municipality_id));
create policy "tenant admins delete vehicles" on public.vehicles for delete to authenticated
  using (public.is_platform_admin() or public.is_municipal_admin(municipality_id));

create policy "tenant users read stops" on public.route_stops for select to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id));
create policy "tenant admins manage stops" on public.route_stops for all to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id and (public.is_platform_admin() or public.is_municipal_admin(r.municipality_id))))
  with check (exists (select 1 from public.routes r where r.id = route_id and (public.is_platform_admin() or public.is_municipal_admin(r.municipality_id))));

create policy "tenant users read profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_platform_admin() or (public.is_municipal_admin(municipality_id) and municipality_id = public.current_municipality_id()));
create policy "users update own safe profile fields" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "tenant users read assignments" on public.route_assignments for select to authenticated
  using (public.is_platform_admin() or municipality_id = public.current_municipality_id());
create policy "tenant admins create assignments" on public.route_assignments for insert to authenticated
  with check (
    (public.is_platform_admin() or public.is_municipal_admin(municipality_id))
    and exists (select 1 from public.routes r where r.id = route_assignments.route_id and r.municipality_id = route_assignments.municipality_id)
    and exists (select 1 from public.vehicles v where v.id = route_assignments.vehicle_id and v.municipality_id = route_assignments.municipality_id)
    and (driver_id is null or exists (select 1 from public.profiles p where p.id = route_assignments.driver_id and p.municipality_id = route_assignments.municipality_id and p.role::text = 'driver'))
  );
create policy "tenant admins update assignments" on public.route_assignments for update to authenticated
  using (public.is_platform_admin() or public.is_municipal_admin(municipality_id))
  with check (
    (public.is_platform_admin() or public.is_municipal_admin(municipality_id))
    and exists (select 1 from public.routes r where r.id = route_assignments.route_id and r.municipality_id = route_assignments.municipality_id)
    and exists (select 1 from public.vehicles v where v.id = route_assignments.vehicle_id and v.municipality_id = route_assignments.municipality_id)
    and (driver_id is null or exists (select 1 from public.profiles p where p.id = route_assignments.driver_id and p.municipality_id = route_assignments.municipality_id and p.role::text = 'driver'))
  );
create policy "tenant admins delete assignments" on public.route_assignments for delete to authenticated
  using (public.is_platform_admin() or public.is_municipal_admin(municipality_id));

create policy "tenant users read runs" on public.route_runs for select to authenticated
  using (public.is_platform_admin() or municipality_id = public.current_municipality_id());
create policy "drivers create assigned runs" on public.route_runs for insert to authenticated
  with check (
    driver_id = auth.uid()
    and municipality_id = public.current_municipality_id()
    and exists (select 1 from public.route_assignments a where a.route_id = route_runs.route_id and a.vehicle_id = route_runs.vehicle_id and a.municipality_id = route_runs.municipality_id and a.active and (a.driver_id is null or a.driver_id = auth.uid()))
    and public.is_driver_or_admin()
  );
create policy "drivers update own runs" on public.route_runs for update to authenticated
  using ((driver_id = auth.uid() and public.is_driver_or_admin()) or public.is_municipal_admin(municipality_id) or public.is_platform_admin())
  with check ((driver_id = auth.uid() and public.is_driver_or_admin()) or public.is_municipal_admin(municipality_id) or public.is_platform_admin());

create policy "tenant users read locations" on public.vehicle_locations for select to authenticated
  using (exists (select 1 from public.route_runs r where r.id = run_id));
create policy "drivers publish own location" on public.vehicle_locations for insert to authenticated
  with check (exists (select 1 from public.route_runs r where r.id = run_id and r.driver_id = auth.uid()) and public.is_driver_or_admin());
create policy "drivers update own location" on public.vehicle_locations for update to authenticated
  using (exists (select 1 from public.route_runs r where r.id = run_id and r.driver_id = auth.uid()) and public.is_driver_or_admin())
  with check (exists (select 1 from public.route_runs r where r.id = run_id and r.driver_id = auth.uid()) and public.is_driver_or_admin());

create policy "tenant users read alerts" on public.alerts for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin() or exists (select 1 from public.profiles p where p.id = user_id and public.is_municipal_admin(p.municipality_id)));
create policy "users mark own alerts read" on public.alerts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.municipalities to authenticated;
grant select, insert, update, delete on public.routes, public.route_stops, public.vehicles, public.route_assignments to authenticated;
revoke update (route_id) on public.profiles from authenticated;
grant execute on function public.select_municipality(uuid) to authenticated;
grant execute on function public.set_user_access(text, text, uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.route_assignments;
exception when duplicate_object then null;
end $$;

alter table public.routes
  add column route_path jsonb,
  add column route_waypoints jsonb,
  add column route_distance_m integer,
  add column route_duration_s integer;

alter table public.routes
  add constraint routes_path_is_linestring check (
    route_path is null
    or (
      route_path ->> 'type' = 'LineString'
      and jsonb_typeof(route_path -> 'coordinates') = 'array'
      and jsonb_array_length(route_path -> 'coordinates') >= 2
    )
  );

alter table public.municipalities
  add column map_center_lat double precision check (map_center_lat between -90 and 90),
  add column map_center_lng double precision check (map_center_lng between -180 and 180);

create or replace function public.set_municipality_map_center(center_lat double precision, center_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_municipality uuid;
begin
  target_municipality := public.current_municipality_id();
  if target_municipality is null or not public.is_municipal_admin(target_municipality) then
    raise exception 'No autorizado';
  end if;
  if center_lat not between -90 and 90 or center_lng not between -180 and 180 then
    raise exception 'Coordenadas inválidas';
  end if;
  update public.municipalities
  set map_center_lat = center_lat, map_center_lng = center_lng, updated_at = now()
  where id = target_municipality;
end;
$$;

revoke all on function public.set_municipality_map_center(double precision, double precision) from public;
grant execute on function public.set_municipality_map_center(double precision, double precision) to authenticated;

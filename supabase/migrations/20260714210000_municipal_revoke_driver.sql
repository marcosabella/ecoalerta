create or replace function public.municipal_revoke_driver(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_municipality uuid;
begin
  select municipality_id into caller_municipality
  from public.profiles
  where id = auth.uid() and role::text = 'municipal_admin';

  if caller_municipality is null and not public.is_platform_admin() then
    raise exception 'No autorizado';
  end if;

  update public.profiles
  set role = 'neighbor'
  where id = target_user
    and role::text = 'driver'
    and (public.is_platform_admin() or municipality_id = caller_municipality);

  if not found then raise exception 'Conductor inexistente o fuera de su municipio'; end if;
end;
$$;

grant execute on function public.municipal_revoke_driver(uuid) to authenticated;

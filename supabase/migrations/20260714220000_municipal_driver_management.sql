create or replace function public.municipal_finalize_driver(
  target_email text,
  target_full_name text,
  new_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  caller_municipality uuid;
  target_id uuid;
begin
  select municipality_id into caller_municipality
  from public.profiles
  where id = auth.uid() and role::text = 'municipal_admin';

  if caller_municipality is null then raise exception 'No autorizado'; end if;
  if length(new_password) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;

  select id into target_id from auth.users where lower(email) = lower(target_email);
  if target_id is null then raise exception 'La cuenta no pudo ser creada en Auth'; end if;

  if exists (
    select 1 from public.profiles
    where id = target_id
      and (role::text = 'platform_admin' or (municipality_id is not null and municipality_id <> caller_municipality))
  ) then
    raise exception 'El usuario pertenece a otro ámbito administrativo';
  end if;

  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      encrypted_password = crypt(new_password, gen_salt('bf')),
      recovery_token = '',
      banned_until = null,
      updated_at = now()
  where id = target_id;

  update public.profiles
  set full_name = coalesce(nullif(target_full_name, ''), full_name),
      role = 'driver',
      municipality_id = caller_municipality,
      route_id = null,
      updated_at = now()
  where id = target_id;

  if not found then raise exception 'Perfil de usuario inexistente'; end if;
  return target_id;
end;
$$;

revoke all on function public.municipal_finalize_driver(text, text, text) from public;
grant execute on function public.municipal_finalize_driver(text, text, text) to authenticated;

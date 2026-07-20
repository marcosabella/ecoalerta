-- Changing the owner/login email of an account must not leave a previous
-- Google (or other social provider) identity attached to the same user id.

create or replace function public.platform_update_user(
  target_user uuid,
  new_email text,
  target_full_name text,
  new_role text,
  target_municipality uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text := lower(trim(new_email));
begin
  if not public.is_platform_admin() then raise exception 'No autorizado'; end if;
  if target_user = auth.uid() and new_role <> 'platform_admin' then
    raise exception 'No podés quitarte tu propio acceso de plataforma';
  end if;
  if normalized_email = '' or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Correo electrónico inválido';
  end if;
  if new_role not in ('neighbor', 'driver', 'municipal_admin', 'platform_admin') then
    raise exception 'Rol inválido';
  end if;
  if new_role <> 'platform_admin' and target_municipality is null then
    raise exception 'El rol requiere un municipio';
  end if;
  if target_municipality is not null
     and not exists (select 1 from public.municipalities where id = target_municipality) then
    raise exception 'Municipio inexistente';
  end if;
  if exists (
    select 1 from auth.users
    where lower(email) = normalized_email and id <> target_user
  ) then
    raise exception 'El correo electrónico ya está en uso';
  end if;

  update auth.users
  set email = normalized_email,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      updated_at = now()
  where id = target_user;
  if not found then raise exception 'Usuario inexistente'; end if;

  update auth.identities
  set identity_data = jsonb_set(
        jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(normalized_email), true),
        '{email_verified}', 'true'::jsonb, true
      ),
      updated_at = now()
  where user_id = target_user and provider = 'email';

  -- A social identity belongs to the previous person when its provider email
  -- differs from the account's new login email. Leaving it linked would allow
  -- that person to regain this account through OAuth.
  delete from auth.identities
  where user_id = target_user
    and provider <> 'email'
    and lower(coalesce(identity_data ->> 'email', '')) <> normalized_email;

  update public.profiles
  set full_name = coalesce(nullif(trim(target_full_name), ''), full_name),
      role = new_role::public.app_role,
      municipality_id = case when new_role = 'platform_admin' then null else target_municipality end,
      route_id = null,
      updated_at = now()
  where id = target_user;
  if not found then raise exception 'Perfil de usuario inexistente'; end if;

  delete from auth.sessions where user_id = target_user and target_user <> auth.uid();

  insert into public.admin_audit_log(actor_id, target_user_id, action, details)
  values (
    auth.uid(), target_user, 'user_updated',
    jsonb_build_object('email', normalized_email, 'role', new_role, 'municipality_id', target_municipality)
  );
end;
$$;

revoke all on function public.platform_update_user(uuid, text, text, text, uuid) from public;
grant execute on function public.platform_update_user(uuid, text, text, text, uuid) to authenticated;

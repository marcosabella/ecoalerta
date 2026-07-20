-- One-time cleanup for accounts whose login email was changed before stale
-- social identities were automatically unlinked.

delete from auth.sessions
where user_id in (
  select distinct i.user_id
  from auth.identities i
  join auth.users u on u.id = i.user_id
  where i.provider <> 'email'
    and lower(coalesce(i.identity_data ->> 'email', '')) <> lower(coalesce(u.email, ''))
);

delete from auth.identities i
using auth.users u
where u.id = i.user_id
  and i.provider <> 'email'
  and lower(coalesce(i.identity_data ->> 'email', '')) <> lower(coalesce(u.email, ''));

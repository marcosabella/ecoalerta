-- Empty optional codes must not collide with one another in the unique
-- municipality/code constraint. PostgreSQL allows multiple NULL values.
update public.routes
set code = null
where btrim(code) = '';


# EcoAlerta

Aplicación React/Vite multi-municipio conectada a Supabase para autenticación, gestión de flotas y rutas, GPS compartido en tiempo real y notificaciones web push por cercanía.

## Desarrollo local

```bash
npm install
npm run dev
```

La configuración pública vive en `.env.local` (ignorado por Git). La contraseña de la base de datos no se guarda en el proyecto.

## Base de datos

Las migraciones de `supabase/migrations` crean:

- perfiles con roles `neighbor`, `driver`, `municipal_admin` y `platform_admin`;
- municipios aislados mediante políticas RLS;
- rutas, paradas, vehículos, asignaciones y recorridos por municipio;
- última ubicación GPS por recorrido mediante Supabase Realtime;
- preferencias, suscripciones push e historial de alertas;
- políticas RLS para que cada rol acceda solamente a lo necesario.

El registro público siempre crea vecinos. En el primer ingreso cada vecino selecciona su municipio/localidad y solo recibe recorridos y alertas de ese municipio.

## Roles y paneles

- `platform_admin`: crea municipios, agrega camiones y asigna administradores municipales.
- `municipal_admin`: administra su flota, conductores, hojas de ruta, paradas y asignaciones ruta-camión.
- `driver`: inicia únicamente los recorridos que su municipio le asignó y comparte su GPS.
- `neighbor`: selecciona localidad, domicilio, radio de aviso y sigue la flota de su municipio.

Para habilitar el primer administrador de plataforma, primero hay que registrar una cuenta desde la aplicación y ejecutar una sola vez en el SQL Editor:

```sql
update public.profiles
set role = 'platform_admin', municipality_id = null
where id = (select id from auth.users where email = 'correo-del-administrador@dominio.com');
```

Desde ese momento los demás accesos se gestionan en el panel web. Como alternativa, para habilitar manualmente un conductor:

```sql
update public.profiles
set role = 'driver',
    municipality_id = 'UUID-DEL-MUNICIPIO'
where id = (select id from auth.users where email = 'correo-del-conductor@dominio.com');
```

### Gestión de usuarios desde la plataforma

El panel `platform_admin` permite:

- crear cuentas con nombre, correo, contraseña inicial, rol y municipio;
- confirmar y habilitar automáticamente las cuentas creadas por el administrador;
- cambiar o resetear contraseñas con un mínimo de 8 caracteres;
- cambiar roles y asociaciones municipales;
- bloquear o reactivar usuarios;
- cerrar las sesiones activas cuando se cambia una contraseña o se bloquea una cuenta.

Las operaciones sensibles se registran en `admin_audit_log`. Las políticas RLS restrictivas impiden que una cuenta bloqueada siga consultando datos aunque conserve temporalmente un token anterior.

## Paneles administrativos

Los paneles de plataforma y municipio utilizan un menú lateral colapsable y una pantalla independiente por módulo.

Plataforma:

- resumen general;
- municipios y localidades;
- flotas por municipio;
- usuarios, roles, contraseñas y bloqueos.

Municipio:

- resumen operativo;
- flota;
- hojas de ruta;
- diseñador de recorridos sobre mapa;
- asignaciones ruta-camión-conductor;
- conductores.

## Recorridos geográficos

Cada hoja de ruta puede guardar:

- puntos de paso editables;
- recorrido vial en formato GeoJSON `LineString`;
- distancia y duración estimadas;
- paradas con coordenadas y horario.

El diseñador usa OpenStreetMap/Leaflet y puede solicitar a OSRM que ajuste los puntos marcados a la red de calles. El mismo trazado se muestra en los celulares del conductor y del vecino junto con las ubicaciones GPS en vivo. Las alertas se calculan con la distancia real entre el camión y el domicilio registrado del vecino dentro del mismo municipio.

## Notificaciones push

La función está en `supabase/functions/proximity-alerts`. Las claves VAPID ya se generaron en `.env.supabase-secrets`, que está ignorado por Git.

Con un token personal configurado en la CLI:

```bash
supabase login
supabase secrets set --project-ref nazysjfjwgpdwpwnceih --env-file .env.supabase-secrets
supabase functions deploy proximity-alerts --project-ref nazysjfjwgpdwpwnceih
```

GPS y Push requieren HTTPS cuando se usan desde celulares reales. El sitio publicado debe agregarse en Supabase Dashboard → Authentication → URL Configuration como `Site URL` y `Redirect URL`.

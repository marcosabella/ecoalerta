import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { importPKCS8, SignJWT } from 'npm:jose@6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

let cachedFcmAccessToken = '';
let cachedFcmAccessTokenUntil = 0;

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(12742000 * Math.asin(Math.sqrt(h)));
};

async function getFcmAccessToken() {
  if (cachedFcmAccessToken && Date.now() < cachedFcmAccessTokenUntil) return cachedFcmAccessToken;

  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL');
  const privateKeyValue = Deno.env.get('FCM_PRIVATE_KEY');
  if (!clientEmail || !privateKeyValue) throw new Error('Las credenciales FCM no están configuradas.');

  const privateKey = await importPKCS8(privateKeyValue.replace(/\\n/g, '\n'), 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(`No se pudo autenticar con FCM: ${result.error_description || result.error || response.status}`);

  cachedFcmAccessToken = result.access_token;
  cachedFcmAccessTokenUntil = Date.now() + Math.max(60, result.expires_in - 120) * 1000;
  return cachedFcmAccessToken;
}

async function sendFcmNotification(token: string, title: string, body: string, runId: string) {
  const projectId = Deno.env.get('FCM_PROJECT_ID');
  if (!projectId) throw new Error('Falta configurar FCM_PROJECT_ID.');
  const accessToken = await getFcmAccessToken();
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: { type: 'proximity', runId, url: '/' },
        android: {
          priority: 'high',
          notification: { channel_id: 'proximity-alerts', sound: 'default' },
        },
      },
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    const errorCode = result?.error?.details?.find((detail: { errorCode?: string }) => detail.errorCode)?.errorCode;
    const error = new Error(result?.error?.message || `FCM respondió ${response.status}`);
    Object.assign(error, { status: response.status, errorCode });
    throw error;
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = request.headers.get('Authorization') || '';
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !user) throw new Error('Sesión inválida.');

    const payload = await request.json();
    const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single();

    if (payload.testPush === true) {
      const { data: devices, error: devicesError } = await admin
        .from('device_push_tokens')
        .select('token')
        .eq('user_id', user.id)
        .eq('platform', 'android');
      if (devicesError) throw devicesError;
      let sent = 0;
      for (const device of devices || []) {
        try {
          await sendFcmNotification(device.token, 'EcoAlerta activada', 'Las notificaciones de Android funcionan correctamente.', 'test');
          sent += 1;
        } catch (error) {
          if (error?.errorCode === 'UNREGISTERED' || error?.status === 404) await admin.from('device_push_tokens').delete().eq('token', device.token);
          else throw error;
        }
      }
      return Response.json({ sent }, { headers: corsHeaders });
    }

    if (!caller || !['driver', 'admin'].includes(caller.role)) {
      return new Response(JSON.stringify({ error: 'No autorizado.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { runId, lat, lng } = payload;
    if (!runId || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Ubicación inválida.');

    const { data: activeRun, error: runError } = await admin.from('route_runs').select('municipality_id,route_id,driver_id,status').eq('id', runId).single();
    if (runError || !activeRun || activeRun.driver_id !== user.id || activeRun.status !== 'active') throw new Error('El recorrido no está activo.');

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:municipio@ecoalerta.ar';
    if (vapidPublic && vapidPrivate) webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { data: settings, error: settingsError } = await admin
      .from('notification_settings')
      .select('user_id,alert_radius_m')
      .eq('push_enabled', true);
    if (settingsError) throw settingsError;

    const ids = (settings || []).map(item => item.user_id);
    if (!ids.length) return Response.json({ sent: 0 }, { headers: corsHeaders });

    const [{ data: profiles }, { data: subscriptions }, { data: deviceTokens }] = await Promise.all([
      admin.from('profiles').select('id,home_lat,home_lng').in('id', ids).eq('role', 'neighbor').eq('municipality_id', activeRun.municipality_id).not('home_lat', 'is', null).not('home_lng', 'is', null),
      admin.from('push_subscriptions').select('user_id,endpoint,p256dh,auth').in('user_id', ids),
      admin.from('device_push_tokens').select('user_id,token,platform').in('user_id', ids).eq('platform', 'android'),
    ]);
    const settingsById = new Map((settings || []).map(item => [item.user_id, item]));
    let sent = 0;

    for (const profile of profiles || []) {
      const preference = settingsById.get(profile.id);
      if (!preference) continue;
      const distance = distanceMeters({ lat, lng }, { lat: profile.home_lat, lng: profile.home_lng });
      if (distance > preference.alert_radius_m) continue;

      const title = 'Camión muy cerca';
      const body = `El camión está a ${distance} m. Es momento de sacar los residuos.`;
      const { error: alertError } = await admin.from('alerts').insert({
        user_id: profile.id,
        run_id: runId,
        kind: 'proximity',
        title,
        body,
        distance_m: distance,
      });
      if (alertError?.code === '23505') continue;
      if (alertError) throw alertError;

      if (vapidPublic && vapidPrivate) {
        for (const subscription of (subscriptions || []).filter(item => item.user_id === profile.id)) {
          try {
            await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            }, JSON.stringify({ title, body, tag: `run-${runId}`, url: '/' }));
            sent += 1;
          } catch (error) {
            if ([404, 410].includes(error?.statusCode)) await admin.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
            else console.error('Web Push error', error);
          }
        }
      }

      for (const device of (deviceTokens || []).filter(item => item.user_id === profile.id)) {
        try {
          await sendFcmNotification(device.token, title, body, runId);
          sent += 1;
        } catch (error) {
          if (error?.errorCode === 'UNREGISTERED' || error?.status === 404) {
            await admin.from('device_push_tokens').delete().eq('token', device.token);
          } else console.error('FCM error', error);
        }
      }
    }

    return Response.json({ sent }, { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

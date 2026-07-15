import { supabase } from './supabase';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

function decodeVapidKey(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

async function enableNativePush(userId) {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('Las notificaciones nativas de iOS todavía no están configuradas.');
  }

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') throw new Error('El permiso de notificaciones no fue concedido.');

  await PushNotifications.createChannel({
    id: 'proximity-alerts',
    name: 'Alertas de cercanía',
    description: 'Avisos cuando el camión recolector se acerca al domicilio.',
    importance: 5,
    visibility: 1,
    vibration: true,
  });

  return new Promise(async (resolve, reject) => {
    let registrationHandle;
    let errorHandle;
    const cleanup = async () => {
      await registrationHandle?.remove();
      await errorHandle?.remove();
    };

    registrationHandle = await PushNotifications.addListener('registration', async registration => {
      const { error } = await supabase.from('device_push_tokens').upsert({
        user_id: userId,
        token: registration.value,
        platform: 'android',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'token' });
      await cleanup();
      if (error) reject(error);
      else resolve();
    });
    errorHandle = await PushNotifications.addListener('registrationError', async error => {
      await cleanup();
      reject(new Error(error?.error || 'No se pudo registrar este celular para recibir notificaciones.'));
    });
    await PushNotifications.register();
  });
}

async function enableWebPush(userId) {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('Falta configurar VITE_VAPID_PUBLIC_KEY.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador no admite notificaciones push.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('El permiso de notificaciones no fue concedido.');

  const registration = await navigator.serviceWorker.register('/sw.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(publicKey),
  });
  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function enablePush(userId) {
  return Capacitor.isNativePlatform() ? enableNativePush(userId) : enableWebPush(userId);
}

export async function sendPushTest() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  const { data, error } = await supabase.functions.invoke('proximity-alerts', { body: { testPush: true } });
  if (error) throw error;
  if (!data?.sent) throw new Error('No se encontró un token FCM activo para este celular.');
  return true;
}

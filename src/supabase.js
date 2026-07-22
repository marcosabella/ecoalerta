import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && publishableKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: !Capacitor.isNativePlatform(),
        flowType: 'pkce',
      },
      realtime: { params: { eventsPerSecond: 4 } },
    })
  : null;

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new Error('Sesión administrativa requerida.');

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const adminClient = createClient(url, serviceKey);

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) throw new Error('Sesión inválida.');

    const { data: caller } = await adminClient.from('profiles').select('role, municipality_id').eq('id', user.id).single();
    if (caller?.role !== 'municipal_admin' || !caller.municipality_id) throw new Error('No autorizado para crear conductores.');

    const { email, password, full_name } = await request.json();
    if (!email || !password || password.length < 8) throw new Error('Ingresá un correo y una contraseña de al menos 8 caracteres.');

    const { data, error } = await adminClient.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: String(full_name || '').trim() },
    });
    if (error && !/already.*registered|already.*exists/i.test(error.message)) throw error;

    return new Response(JSON.stringify({ created: Boolean(data?.user), alreadyExists: Boolean(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Bell, CalendarDays, Check, ChevronRight, CircleUserRound, Clock3, Crosshair, Home, LocateFixed, LockKeyhole, LogOut, MapPin, Menu, Navigation, Play, Plus, Radio, Route, Settings, ShieldCheck, Trash2, Truck, UserRound, Volume2, X } from 'lucide-react';
import { distanceMeters } from './geo';
import { enablePush, sendPushTest } from './push';
import { AdminPanel } from './AdminPanels';
import { LiveRouteMap } from './RouteMap';
import { supabase, supabaseConfigured } from './supabase';
import './styles.css';

const fallbackStops = [
  { name: 'Base Municipal', estimated_time: '07:00', x: 17, y: 78 },
  { name: 'Av. San Martín', estimated_time: '07:18', x: 31, y: 63 },
  { name: 'Plaza del Encuentro', estimated_time: '07:35', x: 49, y: 54 },
  { name: 'Barrio Los Aromos', estimated_time: '07:52', x: 64, y: 35 },
  { name: 'Escuela N° 12', estimated_time: '08:10', x: 82, y: 25 },
];

const timeLabel = value => value?.slice(0, 5) || '--:--';
const userPoint = profile => profile?.home_lat != null ? { lat: profile.home_lat, lng: profile.home_lng } : null;
// La base usa 1=lunes ... 7=domingo; Date#getDay usa 0=domingo ... 6=sábado.
const currentWeekday = () => ((new Date().getDay() + 6) % 7) + 1;
const operatesToday = assignment => Array.isArray(assignment?.weekdays)
  && assignment.weekdays.includes(currentWeekday());
const ROUTE_START_RADIUS_M = 60;

const currentPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error('Este dispositivo no permite obtener la ubicación.'));
  navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
});

async function bestDrivingRoute(from, to) {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?alternatives=true&overview=full&geometries=geojson&steps=true`);
  const result = await response.json();
  if (!response.ok || result.code !== 'Ok' || !result.routes?.length) throw new Error(result.message || 'No se encontró una ruta vial hasta el inicio.');
  const best = [...result.routes].sort((a, b) => a.duration - b.duration)[0];
  return { path: best.geometry, distance: Math.round(best.distance), duration: Math.round(best.duration), start: to };
}

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [municipalities, setMunicipalities] = useState([]);
  const [municipality, setMunicipality] = useState(null);
  const [preferences, setPreferences] = useState({ alert_radius_m: 400, push_enabled: true });
  const [route, setRoute] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [stops, setStops] = useState(fallbackStops);
  const [run, setRun] = useState(null);
  const [location, setLocation] = useState(null);
  const [approach, setApproach] = useState(null);
  const [locatingStart, setLocatingStart] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [screen, setScreen] = useState('home');
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const lastPushCheck = useRef(0);
  const sessionUserId = useRef(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { sessionUserId.current = data.session?.user?.id || null; setSession(data.session); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUserId = nextSession?.user?.id || null;
      if (sessionUserId.current !== nextUserId) setProfile(null);
      sessionUserId.current = nextUserId;
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') { setPasswordRecovery(true); setScreen('settings'); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!session?.user) return;
    const [profileResult, settingsResult, municipalityResult, alertsResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('notification_settings').select('*').eq('user_id', session.user.id).single(),
      supabase.from('municipalities').select('*').order('locality'),
      supabase.from('alerts').select('*').eq('user_id', session.user.id).order('sent_at', { ascending: false }).limit(30),
    ]);
    if (profileResult.error) { setToast(`No se pudo cargar el perfil: ${profileResult.error.message}`); return; }
    const nextProfile = profileResult.data;
    setProfile(nextProfile);
    if (settingsResult.data) setPreferences(settingsResult.data);
    setMunicipalities(municipalityResult.data || []);
    setMunicipality((municipalityResult.data || []).find(item => item.id === nextProfile.municipality_id) || null);
    setAlerts(alertsResult.data || []);
    if (['admin', 'platform_admin', 'municipal_admin'].includes(nextProfile.role) || !nextProfile.municipality_id) return;

    const runQuery = supabase.from('route_runs').select('*').eq('municipality_id', nextProfile.municipality_id).in('status', ['active', 'paused']).order('created_at', { ascending: false }).limit(1);
    if (nextProfile.role === 'driver') runQuery.eq('driver_id', session.user.id);
    const [routesResult, vehiclesResult, assignmentsResult, runResult] = await Promise.all([
      supabase.from('routes').select('*').eq('municipality_id', nextProfile.municipality_id).eq('active', true).order('name'),
      supabase.from('vehicles').select('*').eq('municipality_id', nextProfile.municipality_id).eq('active', true).order('unit_number'),
      supabase.from('route_assignments').select('*').eq('municipality_id', nextProfile.municipality_id).eq('active', true).order('created_at', { ascending: false }),
      runQuery.maybeSingle(),
    ]);
    const assignments = assignmentsResult.data || [];
    const todayAssignments = assignments.filter(operatesToday);
    const queriedRun = runResult.data || null;
    const activeRun = queriedRun && todayAssignments.some(item =>
      item.route_id === queriedRun.route_id
      && item.vehicle_id === queriedRun.vehicle_id
      && (nextProfile.role !== 'driver' || !item.driver_id || item.driver_id === session.user.id)
    ) ? queriedRun : null;
    const selectedAssignment = nextProfile.role === 'driver'
      ? todayAssignments.find(item => item.driver_id === session.user.id) || todayAssignments.find(item => !item.driver_id)
      : todayAssignments.find(item => item.route_id === activeRun?.route_id && item.vehicle_id === activeRun?.vehicle_id) || todayAssignments[0];
    const selectedRoute = (routesResult.data || []).find(item => item.id === (activeRun?.route_id || selectedAssignment?.route_id)) || null;
    const selectedVehicle = (vehiclesResult.data || []).find(item => item.id === (activeRun?.vehicle_id || selectedAssignment?.vehicle_id)) || null;
    const stopsResult = selectedRoute
      ? await supabase.from('route_stops').select('*').eq('route_id', selectedRoute.id).order('stop_order')
      : { data: [] };
    setAssignment(selectedAssignment || null);
    setRoute(selectedRoute);
    setVehicle(selectedVehicle);
    setStops(stopsResult.data?.length ? stopsResult.data.map((stop, index) => ({ ...stop, x: fallbackStops[index]?.x, y: fallbackStops[index]?.y })) : []);
    setRun(activeRun);
    if (activeRun) {
      const { data } = await supabase.from('vehicle_locations').select('*').eq('run_id', activeRun.id).maybeSingle();
      setLocation(data || null);
    } else setLocation(null);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!session || !profile?.municipality_id || ['admin', 'platform_admin', 'municipal_admin'].includes(profile.role)) return;
    const channel = supabase.channel('ecoalerta-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_runs' }, payload => {
        const next = payload.new;
        if (next?.municipality_id === profile.municipality_id && (profile.role !== 'driver' || next.driver_id === session.user.id)) setRun(['active', 'paused'].includes(next.status) ? next : null);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_locations' }, payload => {
        if (payload.new?.run_id === run?.id) setLocation(payload.new);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter: `user_id=eq.${session.user.id}` }, payload => {
        setAlerts(items => [payload.new, ...items]);
        setToast(payload.new.body);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, profile?.municipality_id, profile?.role, run?.id]);

  const running = run?.status === 'active';
  useEffect(() => {
    if (!running || profile?.role !== 'driver' || !navigator.geolocation) return;
    const watcher = navigator.geolocation.watchPosition(async position => {
      const next = {
        run_id: run.id,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy_m: position.coords.accuracy,
        heading: position.coords.heading,
        speed_mps: position.coords.speed,
        recorded_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('vehicle_locations').upsert(next);
      if (error) { setToast(`No se pudo compartir el GPS: ${error.message}`); return; }
      setLocation(next);
      if (Date.now() - lastPushCheck.current > 20000) {
        lastPushCheck.current = Date.now();
        supabase.functions.invoke('proximity-alerts', { body: { runId: run.id, lat: next.lat, lng: next.lng } });
      }
    }, error => setToast(`Activá el permiso de ubicación: ${error.message}`), {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [running, run?.id, profile?.role]);

  const createRun = async () => {
    if (!assignment) return setToast('No tenés una hoja de ruta asignada. Consultá al administrador municipal.');
    const { data, error } = await supabase.from('route_runs').insert({ municipality_id: profile.municipality_id, route_id: assignment.route_id, vehicle_id: assignment.vehicle_id, driver_id: session.user.id, status: 'active', started_at: new Date().toISOString() }).select().single();
    if (error) return setToast(error.message);
    setApproach(null); setRun(data);
    setToast('Llegaste al inicio. El recorrido está activo y los vecinos ya pueden verte.');
  };

  useEffect(() => {
    if (!approach || profile?.role !== 'driver' || !navigator.geolocation) return;
    let activating = false;
    const watcher = navigator.geolocation.watchPosition(position => {
      const next = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy_m: position.coords.accuracy };
      setLocation(next);
      if (!activating && distanceMeters(next, approach.start) <= ROUTE_START_RADIUS_M) { activating = true; createRun(); }
    }, error => setToast(`No se pudo seguir el traslado: ${error.message}`), { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [approach, profile?.role]);

  const toggleRun = async () => {
    if (profile?.role !== 'driver') return;
    if (run) {
      const nextStatus = running ? 'paused' : 'active';
      const { data, error } = await supabase.from('route_runs').update({ status: nextStatus }).eq('id', run.id).select().single();
      if (error) return setToast(error.message);
      setRun(data);
      setToast(nextStatus === 'active' ? 'GPS activado. Los vecinos ya pueden verte.' : 'El recorrido fue pausado.');
      return;
    }
    if (!assignment) return setToast('No tenés una hoja de ruta asignada. Consultá al administrador municipal.');
    const firstCoordinate = route?.route_path?.coordinates?.[0];
    if (!firstCoordinate) return createRun();
    setLocatingStart(true);
    try {
      const position = await currentPosition();
      const current = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy_m: position.coords.accuracy };
      const start = { lat: firstCoordinate[1], lng: firstCoordinate[0] };
      setLocation(current);
      if (distanceMeters(current, start) <= ROUTE_START_RADIUS_M) return createRun();
      const navigation = await bestDrivingRoute(current, start);
      setApproach(navigation);
      setToast(`Te guiamos al inicio: ${(navigation.distance / 1000).toFixed(1)} km, aproximadamente ${Math.max(1, Math.round(navigation.duration / 60))} min.`);
    } catch (error) { setToast(`No se pudo calcular el traslado al inicio: ${error.message}`); }
    finally { setLocatingStart(false); }
  };

  const finishRun = async () => {
    if (!run || profile?.role !== 'driver') return;
    const { error } = await supabase.from('route_runs').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', run.id);
    if (error) return setToast(error.message);
    setRun(null);
    setLocation(null);
    setToast('Recorrido finalizado correctamente.');
  };

  const savePreferences = async next => {
    setPreferences(current => ({ ...current, ...next }));
    const { error } = await supabase.from('notification_settings').update({ ...next, updated_at: new Date().toISOString() }).eq('user_id', session.user.id);
    if (error) setToast(error.message);
  };

  const saveProfile = async values => {
    const { data, error } = await supabase.from('profiles').update({ ...values, updated_at: new Date().toISOString() }).eq('id', session.user.id).select().single();
    if (error) return setToast(error.message);
    setProfile(data);
    setToast('Cambios guardados.');
  };

  const setHomeFromGps = onLocated => {
    if (!navigator.geolocation) return setToast('Tu navegador no permite obtener la ubicación.');
    navigator.geolocation.getCurrentPosition(async position => {
      const { latitude: home_lat, longitude: home_lng } = position.coords;
      let address = `${home_lat.toFixed(6)}, ${home_lng.toFixed(6)}`;
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${home_lat}&lon=${home_lng}&accept-language=es`);
        if (response.ok) {
          const place = await response.json();
          if (place.display_name) address = place.display_name;
        }
      } catch (_error) {
        // Si la geocodificación falla, las coordenadas siguen identificando el domicilio.
      }
      onLocated?.(address);
      await saveProfile({ home_lat, home_lng, address });
    }, error => setToast(`No se pudo obtener tu ubicación: ${error.message}`), {
      enableHighAccuracy: true,
      timeout: 15000,
    });
  };

  const activatePush = async () => {
    try { await enablePush(session.user.id); await savePreferences({ push_enabled: true }); const tested = await sendPushTest(); setToast(tested ? 'Notificación de prueba enviada. Revisá la bandeja de Android.' : 'Notificaciones push activadas en este celular.'); }
    catch (error) { setToast(error.message); }
  };

  const chooseMunicipality = async municipalityId => {
    const { error } = await supabase.rpc('select_municipality', { target_municipality: municipalityId });
    if (error) return setToast(error.message);
    setProfile(current => ({ ...current, municipality_id: municipalityId, route_id: null }));
    setToast('Localidad configurada.');
    await loadData();
  };

  if (authLoading) return <Splash text="Conectando con EcoAlerta…" />;
  if (!supabaseConfigured) return <Splash text="Falta configurar Supabase en .env.local" />;
  if (!session) return <Landing />;
  if (!profile) return <Splash text="Cargando tu perfil…" />;

  if (['admin', 'platform_admin', 'municipal_admin'].includes(profile.role)) return <><AdminPanel profile={profile} email={session.user.email} onSignOut={() => supabase.auth.signOut()} notify={setToast} initialSection={passwordRecovery ? 'password' : undefined} />{toast && <Toast text={toast} close={() => setToast('')} />}</>;
  if (passwordRecovery) return <div className="municipality-picker"><div className="municipality-picker-card"><Brand /><LockKeyhole className="picker-icon" /><small>RECUPERACIÓN DE CUENTA</small><h1>Creá una nueva contraseña</h1><p>Elegí una contraseña segura de al menos 8 caracteres para volver a ingresar.</p><PasswordCard /><button className="link-button" onClick={() => supabase.auth.signOut()}>Volver al ingreso</button></div></div>;
  if (profile.role === 'neighbor' && !profile.municipality_id) return <><MunicipalityPicker municipalities={municipalities} choose={chooseMunicipality} signOut={() => supabase.auth.signOut()} />{toast && <Toast text={toast} close={() => setToast('')} />}</>;
  if (profile.role === 'driver' && !profile.municipality_id) return <Splash text="Tu cuenta de conductor todavía no fue asociada a un municipio." />;

  const role = profile.role === 'driver' ? 'truck' : 'neighbor';
  const homeGeo = userPoint(profile);
  const truckGeo = location ? { lat: location.lat, lng: location.lng } : null;
  const meters = distanceMeters(homeGeo, truckGeo);
  const navigate = async next => {
    setScreen(next);
    setMenu(false);
    if (next === 'alerts' && alerts.some(item => !item.read_at)) {
      const readAt = new Date().toISOString();
      const { error } = await supabase.from('alerts').update({ read_at: readAt }).eq('user_id', session.user.id).is('read_at', null);
      if (!error) setAlerts(items => items.map(item => item.read_at ? item : { ...item, read_at: readAt }));
    }
  };
  const displayName = profile.full_name || session.user.email?.split('@')[0] || 'Usuario';

  return <div className="app-shell">
    <header className="topbar">
      <button className="icon-btn mobile-only" onClick={() => setMenu(true)}><Menu /></button><Brand compact />
      <div className="role-pill"><span className={running ? 'live-dot' : 'gray-dot'} /> {role === 'truck' ? `UNIDAD ${vehicle?.unit_number || '—'}` : municipality?.locality || 'VECINO'}</div>
      <button className="avatar" onClick={() => navigate('settings')}>{displayName.slice(0, 2).toUpperCase()}</button>
    </header>
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <div className="side-head"><Brand compact /><button className="icon-btn mobile-only" onClick={() => setMenu(false)}><X /></button></div>
      <div className="profile-card"><div className="profile-icon">{role === 'truck' ? <Truck /> : <UserRound />}</div><div><b>{displayName}</b><small>{role === 'truck' ? `Chofer · Unidad ${vehicle?.unit_number || 'sin asignar'}` : municipality?.name || 'Vecino registrado'}</small></div></div>
      <nav>
        <Nav active={screen === 'home'} icon={<Home />} label="Inicio" onClick={() => navigate('home')} />
        <Nav active={screen === 'route'} icon={<Route />} label={role === 'truck' ? 'Hoja de ruta' : 'Recorrido de hoy'} onClick={() => navigate('route')} />
        <Nav active={screen === 'alerts'} icon={<Bell />} label="Alertas" onClick={() => navigate('alerts')} badge={alerts.filter(item => !item.read_at).length || null} />
        <Nav active={screen === 'settings'} icon={<Settings />} label="Configuración" onClick={() => navigate('settings')} />
      </nav>
      <button className="logout" onClick={() => supabase.auth.signOut()}><LogOut /> Cerrar sesión</button>
    </aside>
    <main className="content">
      {screen === 'home' && (role === 'truck'
        ? <TruckHome running={running} hasRun={Boolean(run)} approach={approach} locatingStart={locatingStart} cancelApproach={() => { setApproach(null); setLocation(null); }} toggleRun={toggleRun} finishRun={finishRun} route={route} vehicle={vehicle} stops={stops} truckGeo={truckGeo} location={location} />
        : <NeighborHome running={running} route={route} stops={stops} vehicle={vehicle} municipality={municipality} truckGeo={truckGeo} homeGeo={homeGeo} meters={meters} radius={preferences.alert_radius_m} setScreen={setScreen} hasHome={Boolean(homeGeo)} />)}
      {screen === 'route' && <RouteScreen role={role} route={route} stops={stops} truckGeo={truckGeo} homeGeo={role === 'neighbor' ? homeGeo : null} running={running} />}
      {screen === 'alerts' && <AlertsScreen role={role} radius={preferences.alert_radius_m} alertsEnabled={preferences.push_enabled} savePreferences={savePreferences} meters={meters} alerts={alerts} activatePush={activatePush} />}
      {screen === 'settings' && <SettingsScreen role={role} profile={profile} email={session.user.email} municipality={municipality} municipalities={municipalities} chooseMunicipality={chooseMunicipality} vehicle={vehicle} saveProfile={saveProfile} setHomeFromGps={setHomeFromGps} />}
    </main>
    {toast && <Toast text={toast} close={() => setToast('')} />}
  </div>;
}

function Landing() {
  const [selectedRole, setSelectedRole] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const chooseRole = role => {
    setSelectedRole(role);
    setRegistering(false);
    setMessage('');
    setShowLogin(true);
  };

  const changeRole = () => {
    setShowLogin(false);
    setSelectedRole(null);
    setRegistering(false);
    setMessage('');
  };

  const roleLabel = selectedRole === 'truck' ? 'Conductor' : selectedRole === 'administrator' ? 'Administración' : 'Vecino';

  const submit = async event => {
    event.preventDefault(); setLoading(true); setMessage('');
    if (registering) {
      const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { full_name: form.name } } });
      setLoading(false);
      if (error) return setMessage(error.message);
      if (!data.session) setMessage('Revisá tu correo para confirmar la cuenta.');
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
    setLoading(false);
    if (error) return setMessage('Correo o contraseña incorrectos.');
    if (selectedRole === 'truck') {
      const { data: driver } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      if (driver?.role !== 'driver') { await supabase.auth.signOut(); setMessage('Esta cuenta no está habilitada como conductor.'); }
    } else if (selectedRole === 'administrator') {
      const { data: administrator } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      if (!['admin', 'platform_admin', 'municipal_admin'].includes(administrator?.role)) { await supabase.auth.signOut(); setMessage('Esta cuenta no tiene permisos de administración.'); }
    }
  };

  const continueWithGoogle = async () => {
    setLoading(true);
    setMessage('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      setLoading(false);
      setMessage(`No se pudo iniciar con Google: ${error.message}`);
    }
  };

  const recoverPassword = async () => {
    if (!form.email) return setMessage('Ingresá tu correo electrónico para recuperar la contraseña.');
    setLoading(true); setMessage('');
    const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: `${window.location.origin}${window.location.pathname}` });
    setLoading(false);
    setMessage(error ? `No se pudo enviar el correo: ${error.message}` : 'Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.');
  };

  return <div className="landing"><section className="hero-panel"><Brand /><div className="hero-copy"><span className="eyebrow">TU BARRIO, MÁS LIMPIO</span><h1>La recolección,<br /><em>más cerca tuyo.</em></h1><p>Seguí el camión en tiempo real y recibí una alerta justo antes de que pase por tu casa.</p><div className="hero-points"><span><Radio /> Ubicación en vivo</span><span><Bell /> Alertas personalizadas</span><span><Route /> Rutas inteligentes</span></div></div><small className="copyright">© 2026 EcoAlerta · Municipio conectado</small></section>
    <section className="login-panel"><div className="login-card"><div className="welcome-icon"><Truck /></div><h2>¡Hola de nuevo!</h2><p>Elegí cómo querés ingresar</p>
      {!showLogin && <div className="role-selector three-roles"><button onClick={() => chooseRole('neighbor')}><UserRound /><b>Soy vecino</b><small>Quiero recibir alertas</small></button><button onClick={() => chooseRole('truck')}><Truck /><b>Soy conductor</b><small>Gestiono el recorrido</small></button><button onClick={() => chooseRole('administrator')}><ShieldCheck /><b>Administración</b><small>Gestiono la plataforma</small></button></div>}
      {showLogin && <><div className="selected-role-summary"><span>{selectedRole === 'truck' ? <Truck /> : selectedRole === 'administrator' ? <ShieldCheck /> : <UserRound />}<b>{roleLabel}</b></span><button type="button" onClick={changeRole}><ArrowLeft /> Cambiar rol</button></div><form onSubmit={submit} className="login-form">
        {selectedRole === 'neighbor' && <><button type="button" className="google-auth-button" disabled={loading} onClick={continueWithGoogle}><GoogleMark /> Continuar con Google</button><div className="auth-divider"><span>o con correo electrónico</span></div></>}
        {registering && <label>Nombre completo<div><UserRound /><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div></label>}
        <label>Correo electrónico<div><CircleUserRound /><input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div></label>
        <label>Contraseña<div><LockKeyhole /><input required minLength="8" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div></label>
        {!registering && <button type="button" className="link-button" disabled={loading} onClick={recoverPassword}>Olvidé mi contraseña</button>}
        {message && <p className="form-message">{message}</p>}<button className="primary big" disabled={loading}>{loading ? 'Conectando…' : registering ? 'Crear cuenta' : 'Ingresar'} <ChevronRight /></button>
        {selectedRole === 'neighbor' && <button type="button" className="link-button" onClick={() => { setRegistering(!registering); setMessage(''); }}>{registering ? 'Ya tengo una cuenta' : 'Crear cuenta de vecino'}</button>}
      </form></>}
      <p className="secure"><ShieldCheck /> Tus datos están protegidos</p></div></section></div>;
}

function GoogleMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"/><path fill="#34a853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.64.39 3.19 1.04 4.55l3.35-2.62Z"/><path fill="#ea4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"/></svg>;
}

function TruckHome({ running, hasRun, approach, locatingStart, cancelApproach, toggleRun, finishRun, route, vehicle, stops, truckGeo, location }) {
  const approaching = Boolean(approach);
  return <><PageTitle eyebrow="RECORRIDO DE HOY" title="Panel del conductor" subtitle="Tu GPS se comparte únicamente mientras el recorrido está activo." />
    <div className="run-controls">{approaching ? <button className="start-button stop" onClick={cancelApproach}><span><X /></span><div><small>NAVEGACIÓN PREVIA</small>Cancelar traslado</div></button> : <button className={`start-button ${running ? 'stop' : ''}`} disabled={locatingStart} onClick={toggleRun}>{running ? <><span><X /></span><div><small>DETENER TEMPORALMENTE</small>Pausar recorrido</div></> : <><span><Play /></span><div><small>{locatingStart ? 'CALCULANDO MEJOR RUTA' : 'ACTIVAR GPS'}</small>{locatingStart ? 'Ubicando el camión…' : hasRun ? 'Reanudar recorrido' : 'Iniciar recorrido'}</div></>}</button>}{hasRun && <button className="outline finish-button" onClick={finishRun}><Check /> Finalizar recorrido</button>}</div>
    <section className={`status-banner ${running || approaching ? 'active' : ''}`}><div className="status-symbol">{running ? <Radio /> : approaching ? <Navigation /> : <Truck />}</div><div><small>{approaching ? 'TRASLADO AL PUNTO DE INICIO' : 'ESTADO DEL RECORRIDO'}</small><h3>{running ? 'Recorrido en curso' : approaching ? 'Seguí la ruta marcada hasta el inicio' : 'Listo para comenzar'}</h3><p>{running ? 'Tu ubicación se comparte en tiempo real con los vecinos.' : approaching ? `${(approach.distance / 1000).toFixed(1)} km · ${Math.max(1, Math.round(approach.duration / 60))} min estimados. El recorrido se activará al llegar.` : 'Revisá la hoja de ruta antes de iniciar.'}</p></div><span className="status-tag">{running ? 'EN VIVO' : approaching ? 'HACIA EL INICIO' : 'EN PAUSA'}</span></section>
    <div className="dashboard-grid"><MapCard route={route} stops={stops} truckGeo={truckGeo} running={running} navigationPath={approach?.path} routeStart={approach?.start} location={location} /><div className="side-stack"><RouteSummary route={route} stops={stops} /></div></div>
    <section className="stats"><div><span><LocateFixed /></span><p><b>{location ? 'GPS conectado' : 'GPS en espera'}</b><small>{location?.accuracy_m ? `Precisión ±${Math.round(location.accuracy_m)} m` : 'Se solicitará al iniciar'}</small></p></div><div><span><Truck /></span><p><b>Unidad {vehicle?.unit_number || 'sin asignar'}</b><small>{vehicle?.plate || 'La asigna el municipio'}</small></p></div><div><span><Bell /></span><p><b>Alertas automáticas</b><small>Una por recorrido y domicilio</small></p></div></section></>;
}

function NeighborHome({ running, route, stops, vehicle, municipality, truckGeo, homeGeo, meters, radius, setScreen, hasHome }) {
  const near = running && meters != null && meters <= radius;
  return <><PageTitle eyebrow="SEGUIMIENTO EN VIVO" title="Tu recolección" subtitle="Te avisamos cuando el camión se acerque a tu domicilio." />
    <section className={`neighbor-status ${near ? 'near' : ''}`}><div className="pulse-icon"><Bell /></div><div><small>{near ? 'ALERTA DE CERCANÍA' : running ? 'RECOLECCIÓN EN CURSO' : 'PRÓXIMA RECOLECCIÓN'}</small><h2>{!hasHome ? 'Configurá la ubicación de tu casa' : near ? '¡El camión está cerca!' : running && meters != null ? `A ${meters} metros de tu casa` : 'Esperando el inicio del recorrido'}</h2><p>{municipality?.name}{route ? ` · ${route.name}` : ''}</p></div><button onClick={() => setScreen(hasHome ? 'alerts' : 'settings')}><Settings /> {hasHome ? `Radio: ${radius} m` : 'Configurar'}</button></section>
    <div className="neighbor-grid"><MapCard route={route} stops={stops} truckGeo={truckGeo} homeGeo={homeGeo} running={running} /><div className="side-stack"><section className="card next-card"><small>RECORRIDO DE {municipality?.locality?.toUpperCase()}</small><div className="calendar-box"><CalendarDays /><div><b>{route?.schedule_text || 'Cronograma municipal'}</b><p>{route ? `${timeLabel(route.starts_at)} a ${timeLabel(route.ends_at)} h` : 'No hay una ruta activa'}</p></div></div><div className="line-info"><span className="green-line" /><div><b>{vehicle ? `Camión Unidad ${vehicle.unit_number}` : 'Flota municipal'}</b><small>{running ? 'En recorrido · Ubicación actualizada' : 'Sin transmisión en este momento'}</small></div></div></section><section className="card tip"><div><Trash2 /></div><p><b>Recordatorio</b><span>Sacá las bolsas bien cerradas y evitá dejar residuos sueltos.</span></p></section></div></div></>;
}

function RouteSummary({ route, stops }) { return <section className="card route-summary"><div className="card-title"><div><small>RUTA ASIGNADA</small><h3>{route?.name || 'Zona Norte · Circuito B'}</h3></div><span className="route-chip">{route?.code || 'RN-04'}</span></div><div className="route-meta"><span><Clock3 /> {timeLabel(route?.starts_at)} – {timeLabel(route?.ends_at)}</span><span><Navigation /> {stops.length} paradas</span></div><div className="stop-list">{stops.slice(0, 4).map((stop, index) => <div key={stop.id || stop.name}><span>{index + 1}</span><p><b>{stop.name}</b><small>{timeLabel(stop.estimated_time)} h</small></p></div>)}</div></section>; }

function MapCard({ route, stops, truckGeo, homeGeo, running, navigationPath, routeStart }) {
  return <section className="map-card card"><div className="map-toolbar"><div><small>{navigationPath ? 'MEJOR RUTA HASTA EL INICIO' : 'RECORRIDO Y UBICACIÓN EN TIEMPO REAL'}</small><b>{route?.route_path ? route.name : 'El municipio todavía no dibujó el recorrido'}</b></div><button title="Mapa geográfico"><Crosshair /></button></div><LiveRouteMap routePath={route?.route_path} navigationPath={navigationPath} routeStart={routeStart} stops={stops} truck={truckGeo} home={homeGeo} running={running} /><div className="map-footer"><span><span className={running ? 'live-dot' : 'gray-dot'} /> {running ? 'Transmitiendo ubicación' : navigationPath ? 'Navegando al inicio' : 'GPS en espera'}</span><small>{running ? 'Actualización automática' : navigationPath ? 'Los vecinos aún no ven el camión' : 'Sin actividad'}</small></div></section>;
}

function RouteScreen({ role, route, stops, truckGeo, homeGeo, running }) { return <><PageTitle eyebrow="HOJA DE RUTA" title={route?.name || 'Ruta sin asignar'} subtitle={role === 'truck' ? 'Ruta asignada para hoy.' : 'Recorrido de recolección asignado a tu zona.'} /><div className="dashboard-grid"><MapCard route={route} stops={stops} truckGeo={truckGeo} homeGeo={homeGeo} running={running} /><section className="card route-detail"><div className="card-title"><div><small>PARADAS DEL RECORRIDO</small><h3>{route?.schedule_text || 'Turno mañana'}</h3></div></div>{stops.map((stop, index) => <div className="route-row" key={stop.id || stop.name}><span>{index + 1}</span><div><b>{stop.name}</b><small><MapPin /> Punto de control · {timeLabel(stop.estimated_time)} h</small></div></div>)}</section></div></>; }

function AlertsScreen({ role, radius, alertsEnabled, savePreferences, meters, alerts, activatePush }) {
  if (role === 'truck') return <><PageTitle eyebrow="CENTRO DE ALERTAS" title="Avisos del recorrido" subtitle="Las alertas se generan automáticamente al entrar en el radio de cada vecino." /><section className="card alerts-table"><div className="big-stat"><Bell /><div><b>{alerts.length}</b><span>alertas registradas para esta cuenta</span></div></div></section></>;
  return <><PageTitle eyebrow="CENTRO DE ALERTAS" title="Tus notificaciones" subtitle="Elegí con cuánta anticipación querés que te avisemos." /><div className="settings-grid"><section className="card radius-card"><div className="setting-head"><span><LocateFixed /></span><div><h3>Radio de cercanía</h3><p>Te avisaremos cuando el camión entre en esta zona.</p></div></div><div className="radius-number"><b>{radius}</b><span>metros</span></div><input type="range" min="100" max="1000" step="50" value={radius} onChange={event => savePreferences({ alert_radius_m: +event.target.value })} /><div className="range-labels"><span>100 m</span><span>1 km</span></div><div className="estimate"><Clock3 /><span>Aviso aproximado <b>{Math.max(1, Math.round(radius / 110))} minutos antes</b></span></div></section><section className="card notification-card"><div className="setting-head"><span><Volume2 /></span><div><h3>Notificaciones push</h3><p>Funcionan incluso con la app en segundo plano.</p></div><button className={`toggle ${alertsEnabled ? 'on' : ''}`} onClick={() => savePreferences({ push_enabled: !alertsEnabled })}><i /></button></div><button className="primary push-button" onClick={activatePush}><Bell /> Activar en este celular</button><p className="distance-now">Distancia actual: <b>{meters == null ? 'sin datos' : `${meters} m`}</b></p></section></div><section className="card alerts-table alert-history"><h3>Historial</h3>{alerts.length ? alerts.map(item => <div className="alert-row" key={item.id}><span><Check /></span><p><b>{item.title}</b><small>{item.body} · {new Date(item.sent_at).toLocaleString('es-AR')}</small></p></div>) : <p className="muted">Todavía no recibiste alertas.</p>}</section></>;
}

function SettingsScreen(props) {
  return <><SettingsProfile {...props} /><div className="settings-grid password-settings-grid"><PasswordCard /></div></>;
}

function SettingsProfile({ role, profile, email, municipality, municipalities, chooseMunicipality, vehicle, saveProfile, setHomeFromGps }) {
  const [form, setForm] = useState({ full_name: profile.full_name || '', address: profile.address || '' });
  return <><PageTitle eyebrow="CONFIGURACIÓN" title="Preferencias de la cuenta" subtitle="Administrá tus datos y la experiencia de EcoAlerta." /><div className="settings-grid"><section className="card form-card"><h3>Datos personales</h3><label>Nombre completo<input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label><label>Correo electrónico<input value={email || ''} disabled /></label>{role === 'neighbor' && <><label>Municipio o localidad<select value={profile.municipality_id || ''} onChange={e => chooseMunicipality(e.target.value)}>{municipalities.map(item => <option key={item.id} value={item.id}>{item.locality} · {item.name}</option>)}</select></label><label>Domicilio<input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></label></>}<button className="primary" onClick={() => saveProfile(form)}>Guardar cambios</button>{role === 'neighbor' && <button className="outline location-button" onClick={() => setHomeFromGps(address => setForm(current => ({ ...current, address })))}><LocateFixed /> Usar ubicación actual como domicilio</button>}</section><section className="card form-card"><h3>{role === 'truck' ? 'Unidad asignada' : 'Municipio seleccionado'}</h3><div className="assigned"><span>{role === 'truck' ? <Truck /> : <MapPin />}</span><div><b>{role === 'truck' ? `Unidad ${vehicle?.unit_number || 'sin asignar'} · ${vehicle?.description || 'Camión recolector'}` : municipality?.name || 'Sin municipio'}</b><small>{role === 'truck' ? vehicle?.plate || 'Sin patente' : `${municipality?.locality || ''}${municipality?.province ? ` · ${municipality.province}` : ''}`}</small></div></div><p className="muted">Las rutas, unidades y alertas corresponden únicamente al municipio seleccionado.</p></section></div></>;
}

function PasswordCard() {
  const [passwords, setPasswords] = useState({ password: '', confirmation: '' });
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const changePassword = async event => {
    event.preventDefault(); setMessage('');
    if (passwords.password.length < 8) return setMessage('La contraseña debe tener al menos 8 caracteres.');
    if (passwords.password !== passwords.confirmation) return setMessage('Las contraseñas no coinciden.');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: passwords.password });
    setSaving(false);
    if (error) return setMessage(error.message);
    setPasswords({ password: '', confirmation: '' }); setMessage('Contraseña actualizada correctamente.');
  };
  return <form className="card form-card" onSubmit={changePassword}><h3>Mi contraseña</h3><label>Nueva contraseña<input required minLength="8" type="password" autoComplete="new-password" value={passwords.password} onChange={e => setPasswords({ ...passwords, password: e.target.value })} /></label><label>Repetir nueva contraseña<input required minLength="8" type="password" autoComplete="new-password" value={passwords.confirmation} onChange={e => setPasswords({ ...passwords, confirmation: e.target.value })} /></label>{message && <p className="form-message">{message}</p>}<button className="primary" disabled={saving}><LockKeyhole /> {saving ? 'Guardando…' : 'Cambiar contraseña'}</button></form>;
}

function MunicipalityPicker({ municipalities, choose, signOut }) {
  const [selected, setSelected] = useState('');
  return <div className="municipality-picker"><div className="municipality-picker-card"><Brand /><MapPin className="picker-icon" /><small>CONFIGURACIÓN INICIAL</small><h1>Elegí tu localidad</h1><p>Vas a recibir recorridos y alertas únicamente de este municipio. Podrás cambiarlo luego desde Configuración.</p><select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Seleccionar municipio o localidad…</option>{municipalities.map(item => <option key={item.id} value={item.id}>{item.locality} · {item.name}{item.province ? ` (${item.province})` : ''}</option>)}</select><button className="primary big" disabled={!selected} onClick={() => choose(selected)}>Confirmar localidad <ChevronRight /></button><button className="link-button" onClick={signOut}>Cerrar sesión</button></div></div>;
}

function Splash({ text }) { return <div className="splash"><Brand /><p>{text}</p></div>; }
function Toast({ text, close }) { return <div className="toast"><div className="toast-icon"><Bell /></div><div><b>EcoAlerta</b><p>{text}</p></div><button onClick={close}><X /></button></div>; }
function PageTitle({ eyebrow, title, subtitle }) { return <div className="page-title"><div><small>{eyebrow}</small><h1>{title}</h1><p>{subtitle}</p></div><div className="date-card"><CalendarDays /><div><b>HOY</b><small>{new Date().toLocaleDateString('es-AR')}</small></div></div></div>; }
function Nav({ icon, label, active, onClick, badge }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span>{badge && <i>{badge}</i>}</button>; }
function Brand({ compact }) { return <div className={`brand ${compact ? 'compact' : ''}`}><span><Trash2 /></span><div><b>EcoAlerta</b><small>RECOLECCIÓN CERCA TUYO</small></div></div>; }

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('EcoAlerta no pudo mostrar la pantalla', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="splash"><Brand /><p>No se pudo cargar esta pantalla.</p><small>{this.state.error.message}</small><button className="primary" onClick={() => window.location.reload()}>Volver a intentar</button></div>;
  }
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>);

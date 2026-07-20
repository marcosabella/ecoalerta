import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Check, ClipboardList, KeyRound, LayoutDashboard, LogOut, Map as MapIcon, MapPin, Menu, Pencil, Plus, Route, ShieldCheck, Trash2, Truck, UserCheck, UserCog, Users, UserX, X } from 'lucide-react';
import { supabase } from './supabase';
import { RouteDesignerMap } from './RouteMap';

const slugify = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const roleOptions = [{ value: 'neighbor', label: 'Vecino' }, { value: 'driver', label: 'Conductor' }, { value: 'municipal_admin', label: 'Administrador municipal' }, { value: 'platform_admin', label: 'Administrador de plataforma' }];

export function AdminPanel({ profile, email, onSignOut, notify, initialSection }) {
  const platform = ['admin', 'platform_admin'].includes(profile.role);
  const displayName = String(profile.full_name || email || 'Administrador');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [section, setSection] = useState(initialSection || 'dashboard');
  const platformItems = [
    { id: 'dashboard', label: 'Resumen', icon: <LayoutDashboard /> },
    { id: 'municipalities', label: 'Municipios', icon: <Building2 /> },
    { id: 'fleet', label: 'Flotas', icon: <Truck /> },
    { id: 'users', label: 'Usuarios y accesos', icon: <Users /> },
    { id: 'password', label: 'Mi contraseña', icon: <KeyRound /> },
  ];
  const municipalityItems = [
    { id: 'dashboard', label: 'Resumen', icon: <LayoutDashboard /> },
    { id: 'fleet', label: 'Flota', icon: <Truck /> },
    { id: 'routes', label: 'Hojas de ruta', icon: <Route /> },
    { id: 'route-map', label: 'Diseñar recorridos', icon: <MapIcon /> },
    { id: 'assignments', label: 'Asignaciones', icon: <ClipboardList /> },
    { id: 'drivers', label: 'Conductores', icon: <Users /> },
    { id: 'password', label: 'Mi contraseña', icon: <KeyRound /> },
  ];
  const items = platform ? platformItems : municipalityItems;
  const navigate = id => { setSection(id); setMobileMenu(false); };
  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 760px)').matches) setMobileMenu(false);
    else setCollapsed(value => !value);
  };
  return <div className={`admin-shell ${collapsed ? 'admin-collapsed' : ''}`}>
    <aside className={`admin-sidebar ${mobileMenu ? 'mobile-open' : ''}`}><div className="admin-sidebar-brand"><button type="button" className="admin-brand-toggle" title={collapsed ? 'Expandir menú' : 'Contraer menú'} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'} onClick={toggleSidebar}><span><Trash2 /></span><div><b>EcoAlerta</b><small>{platform ? 'PLATAFORMA' : 'MUNICIPIO'}</small></div></button><button className="mobile-admin-close" onClick={() => setMobileMenu(false)}><X /></button></div><nav>{items.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav><button className="admin-sidebar-logout" onClick={onSignOut}><LogOut /><span>Cerrar sesión</span></button></aside>
    {mobileMenu && <button className="admin-overlay" onClick={() => setMobileMenu(false)} />}
    <div className="admin-workspace"><header className="admin-topbar"><button className="admin-mobile-menu" onClick={() => setMobileMenu(true)}><Menu /></button><div className="admin-section-name">{items.find(item => item.id === section)?.label}</div><div className="admin-user"><span><b>{displayName}</b><small>{platform ? 'Administrador de plataforma' : 'Administrador municipal'}</small></span><div className="admin-avatar">{displayName.slice(0, 2).toUpperCase()}</div></div></header>
    <main className="admin-content">{section === 'password' ? <AdminPasswordPanel notify={notify} /> : platform ? <PlatformPanel section={section} notify={notify} /> : <MunicipalPanel section={section} profile={profile} notify={notify} />}</main></div>
  </div>;
}

function AdminPasswordPanel({ notify }) {
  const [form, setForm] = useState({ password: '', confirmation: '' });
  const [saving, setSaving] = useState(false);
  const submit = async event => {
    event.preventDefault();
    if (form.password.length < 8) return notify('La contraseña debe tener al menos 8 caracteres.');
    if (form.password !== form.confirmation) return notify('Las contraseñas no coinciden.');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: form.password });
    setSaving(false);
    if (error) return notify(`No se pudo cambiar la contraseña: ${error.message}`);
    setForm({ password: '', confirmation: '' }); notify('Contraseña actualizada correctamente.');
  };
  return <><AdminHeading eyebrow="SEGURIDAD" title="Mi contraseña" subtitle="Actualizá la contraseña de tu propia cuenta." /><AdminCard title="Cambiar contraseña" icon={<KeyRound />}><form className="admin-form" onSubmit={submit}><Field label="Nueva contraseña (mínimo 8 caracteres)" type="password" value={form.password} onChange={password => setForm({ ...form, password })} /><Field label="Repetir nueva contraseña" type="password" value={form.confirmation} onChange={confirmation => setForm({ ...form, confirmation })} /><button className="primary" disabled={saving}><KeyRound /> {saving ? 'Guardando…' : 'Cambiar contraseña'}</button></form></AdminCard></>;
}

function PlatformPanel({ section, notify }) {
  const [municipalities, setMunicipalities] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [users, setUsers] = useState([]);
  const [municipalityForm, setMunicipalityForm] = useState({ name: '', locality: '', province: '', contact_email: '' });
  const [vehicleForm, setVehicleForm] = useState({ municipality_id: '', unit_number: '', plate: '', description: 'Camión recolector' });
  const [editingMunicipalityId, setEditingMunicipalityId] = useState(null);
  const [editingVehicleId, setEditingVehicleId] = useState(null);
  const [userForm, setUserForm] = useState({ full_name: '', email: '', password: '', role: 'neighbor', municipality_id: '' });
  const [editingUser, setEditingUser] = useState(null);

  const load = useCallback(async () => {
    const [municipalityResult, vehicleResult, profileResult, userResult] = await Promise.all([
      supabase.from('municipalities').select('*').order('name'),
      supabase.from('vehicles').select('*,municipalities(name)').order('unit_number'),
      supabase.from('profiles').select('id,full_name,role,municipality_id').order('full_name'),
      supabase.rpc('platform_list_users'),
    ]);
    if (municipalityResult.error) return notify(municipalityResult.error.message);
    setMunicipalities(municipalityResult.data || []);
    setVehicles(vehicleResult.data || []);
    setProfiles(profileResult.data || []);
    if (userResult.error) notify(userResult.error.message); else setUsers(userResult.data || []);
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const createMunicipality = async event => {
    event.preventDefault();
    const payload = { ...municipalityForm, slug: slugify(municipalityForm.name), updated_at: new Date().toISOString() };
    const query = editingMunicipalityId ? supabase.from('municipalities').update(payload).eq('id', editingMunicipalityId) : supabase.from('municipalities').insert(payload);
    const { error } = await query;
    if (error) return notify(error.message);
    setMunicipalityForm({ name: '', locality: '', province: '', contact_email: '' }); setEditingMunicipalityId(null); notify(editingMunicipalityId ? 'Municipio actualizado.' : 'Municipio creado.'); load();
  };
  const createVehicle = async event => {
    event.preventDefault();
    const query = editingVehicleId ? supabase.from('vehicles').update(vehicleForm).eq('id', editingVehicleId) : supabase.from('vehicles').insert(vehicleForm);
    const { error } = await query;
    if (error) return notify(error.message);
    setVehicleForm({ municipality_id: '', unit_number: '', plate: '', description: 'Camión recolector' }); setEditingVehicleId(null); notify(editingVehicleId ? 'Unidad actualizada.' : 'Camión agregado a la flota.'); load();
  };
  const toggleMunicipality = async item => {
    const { error } = await supabase.from('municipalities').update({ active: !item.active, updated_at: new Date().toISOString() }).eq('id', item.id);
    if (error) return notify(error.message);
    notify(item.active ? 'Municipio desactivado.' : 'Municipio activado.'); load();
  };
  const editMunicipality = async item => {
    setMunicipalityForm({ name: item.name || '', locality: item.locality || '', province: item.province || '', contact_email: item.contact_email || '' });
    setEditingMunicipalityId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const deleteMunicipality = async item => {
    if (!window.confirm(`¿Eliminar ${item.name}? También se eliminarán su flota, rutas y asignaciones.`)) return;
    const { error } = await supabase.from('municipalities').delete().eq('id', item.id);
    if (error) return notify(error.message); notify('Municipio eliminado.'); load();
  };
  const editPlatformVehicle = async item => {
    setVehicleForm({ municipality_id: item.municipality_id, unit_number: item.unit_number || '', plate: item.plate || '', description: item.description || '' });
    setEditingVehicleId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const deletePlatformVehicle = async item => {
    if (!window.confirm(`¿Eliminar la unidad ${item.unit_number}? Sus asignaciones también se eliminarán.`)) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', item.id);
    if (error) return notify(error.message); notify('Unidad eliminada.'); load();
  };
  const createUser = async event => {
    event.preventDefault();
    if (!editingUser && userForm.password.length < 8) return notify('La contraseña inicial debe tener al menos 8 caracteres.');
    if (editingUser && userForm.password && userForm.password.length < 8) return notify('La nueva contraseña debe tener al menos 8 caracteres.');
    const municipalityId = userForm.role === 'platform_admin' ? null : userForm.municipality_id || null;
    try {
      if (!editingUser) {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/signup`, {
          method: 'POST', headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userForm.email, password: userForm.password, data: { full_name: userForm.full_name } }),
        });
        if (!response.ok) {
          const body = await response.json();
          if (body.error_code !== 'user_already_exists') throw new Error(body.msg || body.message || 'No se pudo crear la cuenta.');
        }
      }
      let userId = editingUser?.user_id;
      if (editingUser) {
        const { error: updateError } = await supabase.rpc('platform_update_user', { target_user: editingUser.user_id, new_email: userForm.email, target_full_name: userForm.full_name, new_role: userForm.role, target_municipality: municipalityId });
        if (updateError) throw updateError;
      } else {
        const { data, error: finalizeError } = await supabase.rpc('platform_finalize_user', { target_email: userForm.email, target_full_name: userForm.full_name, new_role: userForm.role, target_municipality: municipalityId });
        if (finalizeError) throw finalizeError;
        userId = data;
      }
      if (userForm.password) {
        const { error: passwordError } = await supabase.rpc('platform_set_password', { target_user: userId, new_password: userForm.password });
        if (passwordError) throw passwordError;
      }
      setUserForm({ full_name: '', email: '', password: '', role: 'neighbor', municipality_id: '' });
      notify(editingUser ? 'Usuario actualizado.' : 'Usuario creado, confirmado y habilitado.'); setEditingUser(null); load();
    } catch (error) { notify(error.message); }
  };
  const editUser = user => {
    setEditingUser(user);
    setUserForm({ full_name: user.full_name || '', email: user.email, password: '', role: user.app_role, municipality_id: user.municipality_id || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cancelUserEdit = () => { setEditingUser(null); setUserForm({ full_name: '', email: '', password: '', role: 'neighbor', municipality_id: '' }); };
  const toggleUser = async user => {
    const { error } = await supabase.rpc('platform_set_user_enabled', { target_user: user.user_id, user_enabled: !user.enabled });
    if (error) return notify(error.message);
    notify(user.enabled ? 'Usuario deshabilitado.' : 'Usuario habilitado.'); load();
  };
  const deleteUser = async user => {
    if (!window.confirm(`¿Eliminar definitivamente a ${user.full_name || user.email}? Esta acción elimina su cuenta y no se puede deshacer.`)) return;
    const { error } = await supabase.rpc('platform_delete_user', { target_user: user.user_id });
    if (error) return notify(error.message);
    if (editingUser?.user_id === user.user_id) cancelUserEdit();
    notify('Usuario eliminado.'); load();
  };
  const activeMunicipalities = municipalities.filter(item => item.active);

  if (section === 'dashboard') return <><AdminHeading eyebrow="CONTROL GENERAL" title="Administración de EcoAlerta" subtitle="Una vista consolidada de los municipios y usuarios de la plataforma." /><section className="admin-stats"><Stat icon={<Building2 />} value={activeMunicipalities.length} label="Municipios activos" /><Stat icon={<Truck />} value={vehicles.length} label="Camiones registrados" /><Stat icon={<Users />} value={users.length || profiles.length} label="Usuarios" /><Stat icon={<UserCheck />} value={users.filter(user => user.enabled).length} label="Usuarios habilitados" /></section><div className="admin-welcome"><div><ShieldCheck /><span><h2>Plataforma operativa</h2><p>Usá el menú lateral para administrar cada módulo por separado.</p></span></div><div className="module-shortcuts"><span><Building2 /> Municipios y localidades</span><span><Truck /> Flotas municipales</span><span><Users /> Usuarios, roles y contraseñas</span></div></div></>;

  if (section === 'municipalities') return <><AdminHeading eyebrow="MUNICIPIOS" title="Municipios y localidades" subtitle="Creá, habilitá y administrá las organizaciones que utilizan EcoAlerta." /><div className="screen-two-columns"><AdminCard title="Nuevo municipio" icon={<Building2 />}><form className="admin-form" onSubmit={createMunicipality}><Field label="Nombre institucional" value={municipalityForm.name} onChange={name => setMunicipalityForm({ ...municipalityForm, name })} /><Field label="Localidad" value={municipalityForm.locality} onChange={locality => setMunicipalityForm({ ...municipalityForm, locality })} /><Field label="Provincia" value={municipalityForm.province} onChange={province => setMunicipalityForm({ ...municipalityForm, province })} /><Field label="Correo de contacto" type="email" value={municipalityForm.contact_email} onChange={contact_email => setMunicipalityForm({ ...municipalityForm, contact_email })} /><button className="primary"><Plus /> Crear municipio</button></form></AdminCard><AdminCard title="Municipios registrados" icon={<Building2 />}><div className="admin-table"><div className="admin-table-head municipality-columns"><span>Municipio</span><span>Localidad</span><span>Flota</span><span>Estado</span><span>Acciones</span></div>{municipalities.map(item => <div className="admin-table-row municipality-columns" key={item.id}><span><b>{item.name}</b><small>{item.contact_email || 'Sin contacto'}</small></span><span>{item.locality}<small>{item.province}</small></span><span>{vehicles.filter(vehicle => vehicle.municipality_id === item.id).length} unidades</span><span><button className={item.active ? 'status-active' : 'status-inactive'} onClick={() => toggleMunicipality(item)}>{item.active ? 'Activo' : 'Inactivo'}</button></span><RowActions onEdit={() => editMunicipality(item)} onDelete={() => deleteMunicipality(item)} /></div>)}</div></AdminCard></div></>;

  if (section === 'fleet') return <><AdminHeading eyebrow="FLOTAS" title="Camiones por municipio" subtitle="Registrá unidades y consultá cómo está compuesta cada flota municipal." /><div className="screen-two-columns"><AdminCard title="Agregar camión" icon={<Truck />}><form className="admin-form" onSubmit={createVehicle}><Select label="Municipio" value={vehicleForm.municipality_id} onChange={municipality_id => setVehicleForm({ ...vehicleForm, municipality_id })} options={activeMunicipalities.map(item => ({ value: item.id, label: item.name }))} /><Field label="Número de unidad" value={vehicleForm.unit_number} onChange={unit_number => setVehicleForm({ ...vehicleForm, unit_number })} /><Field label="Patente" value={vehicleForm.plate} onChange={plate => setVehicleForm({ ...vehicleForm, plate })} /><Field label="Descripción" value={vehicleForm.description} onChange={description => setVehicleForm({ ...vehicleForm, description })} /><button className="primary"><Plus /> Agregar a la flota</button></form></AdminCard><AdminCard title="Flota completa" icon={<Truck />}><div className="admin-table"><div className="admin-table-head fleet-columns"><span>Unidad</span><span>Municipio</span><span>Patente</span><span>Estado</span><span>Acciones</span></div>{vehicles.map(item => <div className="admin-table-row fleet-columns" key={item.id}><span><b>Unidad {item.unit_number}</b><small>{item.description}</small></span><span>{item.municipalities?.name}</span><span>{item.plate || '—'}</span><span><i className={item.active ? 'status-active' : 'status-inactive'}>{item.active ? 'Activa' : 'Inactiva'}</i></span><RowActions onEdit={() => editPlatformVehicle(item)} onDelete={() => deletePlatformVehicle(item)} /></div>)}</div></AdminCard></div></>;

  return <><AdminHeading eyebrow="USUARIOS" title="Usuarios, roles y contraseñas" subtitle="Creá, editá y eliminá usuarios, incluidos sus datos de acceso." /><div className="screen-two-columns"><AdminCard title={editingUser ? `Editar usuario · ${editingUser.email}` : 'Crear usuario'} icon={editingUser ? <Pencil /> : <Users />}><form className="admin-form" onSubmit={createUser}><Field label="Nombre completo" value={userForm.full_name} onChange={full_name => setUserForm({ ...userForm, full_name })} /><label>Correo electrónico<input required type="email" value={userForm.email} onChange={event => setUserForm({ ...userForm, email: event.target.value })} /></label><Field label={editingUser ? 'Nueva contraseña (opcional, mínimo 8)' : 'Contraseña inicial (mínimo 8)'} type="password" value={userForm.password} onChange={password => setUserForm({ ...userForm, password })} /><Select label="Rol" value={userForm.role} onChange={role => setUserForm({ ...userForm, role })} options={roleOptions} />{userForm.role !== 'platform_admin' && <Select label="Municipio" value={userForm.municipality_id} onChange={municipality_id => setUserForm({ ...userForm, municipality_id })} options={activeMunicipalities.map(item => ({ value: item.id, label: item.name }))} />}<div className="form-actions"><button className="primary">{editingUser ? <><Check /> Guardar cambios</> : <><Plus /> Crear y habilitar</>}</button>{editingUser && <button type="button" className="outline" onClick={cancelUserEdit}>Cancelar edición</button>}</div></form></AdminCard><AdminCard title="Usuarios y accesos" icon={<Users />}><div className="admin-table"><div className="admin-table-head user-columns"><span>Usuario</span><span>Rol</span><span>Municipio</span><span>Último acceso</span><span>Estado</span><span>Acciones</span></div>{users.map(user => <div className="admin-table-row user-columns" key={user.user_id}><span><b>{user.full_name || 'Sin nombre'}</b><small>{user.email}</small></span><span>{roleLabel(user.app_role)}</span><span>{municipalities.find(item => item.id === user.municipality_id)?.name || 'Plataforma'}</span><span>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString('es-AR') : 'Nunca'}</span><span><i className={user.enabled ? 'status-active' : 'status-inactive'}>{user.enabled ? 'Habilitado' : 'Bloqueado'}</i></span><span className="user-actions"><button title="Editar usuario" aria-label="Editar usuario" onClick={() => editUser(user)}><Pencil /></button><button title={user.enabled ? 'Deshabilitar usuario' : 'Habilitar usuario'} aria-label={user.enabled ? 'Deshabilitar usuario' : 'Habilitar usuario'} onClick={() => toggleUser(user)}>{user.enabled ? <UserX /> : <UserCheck />}</button><button title="Eliminar usuario" aria-label="Eliminar usuario" onClick={() => deleteUser(user)}><Trash2 /></button></span></div>)}</div></AdminCard></div></>;
}

function MunicipalPanel({ section, profile, notify }) {
  const municipalityId = profile.municipality_id;
  const [municipality, setMunicipality] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [stops, setStops] = useState([]);
  const [routeForm, setRouteForm] = useState({ name: '', code: '', zone: '', schedule_text: '', starts_at: '07:00', ends_at: '10:00' });
  const [vehicleForm, setVehicleForm] = useState({ unit_number: '', plate: '', description: 'Camión recolector' });
  const [stopForm, setStopForm] = useState({ route_id: '', name: '', estimated_time: '07:00' });
  const [assignmentForm, setAssignmentForm] = useState({ route_id: '', vehicle_id: '', driver_id: '', weekdays: '2,4,6' });
  const [driverForm, setDriverForm] = useState({ full_name: '', email: '', password: '' });
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [editingVehicleId, setEditingVehicleId] = useState(null);
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);

  const load = useCallback(async () => {
    if (!municipalityId) return;
    const [municipalityResult, routeResult, vehicleResult, driverResult, assignmentResult, stopResult] = await Promise.all([
      supabase.from('municipalities').select('*').eq('id', municipalityId).single(),
      supabase.from('routes').select('*').eq('municipality_id', municipalityId).order('name'),
      supabase.from('vehicles').select('*').eq('municipality_id', municipalityId).order('unit_number'),
      supabase.from('profiles').select('id,full_name,role').eq('municipality_id', municipalityId),
      supabase.from('route_assignments').select('*').eq('municipality_id', municipalityId).order('created_at', { ascending: false }),
      supabase.from('route_stops').select('*').order('stop_order'),
    ]);
    if (municipalityResult.error) return notify(municipalityResult.error.message);
    setMunicipality(municipalityResult.data); setRoutes(routeResult.data || []); setVehicles(vehicleResult.data || []);
    setDrivers((driverResult.data || []).filter(item => item.role === 'driver')); setAssignments(assignmentResult.data || []); setStops(stopResult.data || []);
    setSelectedRouteId(current => current || routeResult.data?.[0]?.id || '');
  }, [municipalityId, notify]);
  useEffect(() => { load(); }, [load]);

  const create = (table, payload, success, reset) => async event => {
    event.preventDefault();
    const editingId = table === 'vehicles' ? editingVehicleId : table === 'routes' ? editingRouteId : null;
    const normalizedPayload = table === 'routes'
      ? { ...payload, code: payload.code?.trim() || null }
      : payload;
    const query = editingId ? supabase.from(table).update(normalizedPayload).eq('id', editingId) : supabase.from(table).insert(normalizedPayload);
    const { error } = await query; if (error) return notify(error.message);
    reset(); if (table === 'vehicles') setEditingVehicleId(null); if (table === 'routes') setEditingRouteId(null);
    notify(editingId ? 'Datos actualizados.' : success); load();
  };
  const createStop = async event => {
    event.preventDefault();
    const nextOrder = stops.filter(item => item.route_id === stopForm.route_id).reduce((max, item) => Math.max(max, item.stop_order), 0) + 1;
    const { error } = await supabase.from('route_stops').insert({ ...stopForm, stop_order: nextOrder });
    if (error) return notify(error.message); setStopForm(current => ({ ...current, name: '' })); notify('Parada agregada.'); load();
  };
  const createAssignment = async event => {
    event.preventDefault();
    const payload = { municipality_id: municipalityId, route_id: assignmentForm.route_id, vehicle_id: assignmentForm.vehicle_id, driver_id: assignmentForm.driver_id || null, weekdays: assignmentForm.weekdays.split(',').map(Number).filter(value => value >= 1 && value <= 7) };
    const query = editingAssignmentId ? supabase.from('route_assignments').update(payload).eq('id', editingAssignmentId) : supabase.from('route_assignments').insert(payload);
    const { error } = await query;
    if (error) return notify(error.message); setEditingAssignmentId(null); notify(editingAssignmentId ? 'Asignación actualizada.' : 'Hoja de ruta asignada al camión.'); load();
  };
  const addDriver = async event => {
    event.preventDefault();
    if (driverForm.password.length < 8) return notify('La contraseña debe tener al menos 8 caracteres.');
    try {
      const { error: createError } = await supabase.functions.invoke('create-driver', {
        body: { email: driverForm.email, password: driverForm.password, full_name: driverForm.full_name },
      });
      if (createError) throw createError;
      const { error } = await supabase.rpc('municipal_finalize_driver', { target_email: driverForm.email, target_full_name: driverForm.full_name, new_password: driverForm.password });
      if (error) throw error;
      setDriverForm({ full_name: '', email: '', password: '' }); notify('Conductor creado y habilitado.'); load();
    } catch (error) { notify(error.message); }
  };
  const toggleActive = async (table, item) => {
    const { error } = await supabase.from(table).update({ active: !item.active }).eq('id', item.id);
    if (error) return notify(error.message);
    notify(item.active ? 'Elemento desactivado.' : 'Elemento activado.'); load();
  };
  const editVehicle = async item => {
    setVehicleForm({ unit_number: item.unit_number || '', plate: item.plate || '', description: item.description || '' });
    setEditingVehicleId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const editRoute = async item => {
    setRouteForm({ name: item.name || '', code: item.code || '', zone: item.zone || '', schedule_text: item.schedule_text || '', starts_at: item.starts_at || '07:00', ends_at: item.ends_at || '10:00' });
    setEditingRouteId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const editAssignment = async item => {
    setAssignmentForm({ route_id: item.route_id, vehicle_id: item.vehicle_id, driver_id: item.driver_id || '', weekdays: Array.isArray(item.weekdays) ? item.weekdays.join(',') : item.weekdays || '' });
    setEditingAssignmentId(item.id); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const removeItem = async (table, item, label, warning = '') => {
    if (!window.confirm(`¿Eliminar ${label}?${warning}`)) return;
    const { error } = await supabase.from(table).delete().eq('id', item.id);
    if (error) return notify(error.message); notify('Elemento eliminado.'); load();
  };
  const revokeDriver = async driver => {
    if (!window.confirm(`¿Quitar a ${driver.full_name || 'este usuario'} del listado de conductores?`)) return;
    const { error } = await supabase.rpc('municipal_revoke_driver', { target_user: driver.id });
    if (error) return notify(error.message); notify('Rol de conductor revocado.'); load();
  };
  const saveRouteGeometry = async geometry => {
    const { error } = await supabase.from('routes').update(geometry).eq('id', selectedRouteId);
    if (error) return notify(error.message);
    notify('Recorrido geográfico guardado.'); load();
  };
  const addMapStop = async stop => {
    const nextOrder = stops.filter(item => item.route_id === selectedRouteId).reduce((max, item) => Math.max(max, item.stop_order), 0) + 1;
    const { error } = await supabase.from('route_stops').insert({ ...stop, route_id: selectedRouteId, stop_order: nextOrder });
    if (error) return notify(error.message);
    notify('Parada ubicada en el mapa.'); load();
  };
  const routeById = useMemo(() => new Map(routes.map(item => [item.id, item])), [routes]);
  const vehicleById = useMemo(() => new Map(vehicles.map(item => [item.id, item])), [vehicles]);
  const driverById = useMemo(() => new Map(drivers.map(item => [item.id, item])), [drivers]);
  const selectedRoute = routes.find(item => item.id === selectedRouteId) || null;

  if (!municipalityId) return <div className="admin-empty"><Building2 /><h2>Cuenta sin municipio</h2><p>Un administrador de plataforma debe asociar esta cuenta a un municipio.</p></div>;
  if (section === 'dashboard') return <><AdminHeading eyebrow="GESTIÓN MUNICIPAL" title={municipality?.name || 'Municipio'} subtitle="Gestioná la operación diaria desde los módulos del menú lateral." /><section className="admin-stats"><Stat icon={<Truck />} value={vehicles.length} label="Camiones" /><Stat icon={<Route />} value={routes.length} label="Hojas de ruta" /><Stat icon={<ClipboardList />} value={assignments.filter(item => item.active).length} label="Asignaciones activas" /><Stat icon={<Users />} value={drivers.length} label="Conductores" /></section><div className="admin-welcome"><div><Building2 /><span><h2>{municipality?.locality}</h2><p>{municipality?.province || 'Operación municipal'} · EcoAlerta</p></span></div><div className="module-shortcuts"><span><Route /> Creá las hojas de ruta</span><span><MapIcon /> Dibujá el recorrido sobre calles reales</span><span><Truck /> Asigná cada trazado a una unidad</span></div></div></>;

  if (section === 'fleet') return <><AdminHeading eyebrow="FLOTA MUNICIPAL" title="Camiones recolectores" subtitle="Registrá y administrá las unidades disponibles en el municipio." /><div className="screen-two-columns"><AdminCard title="Agregar camión" icon={<Truck />}><form className="admin-form" onSubmit={create('vehicles', { ...vehicleForm, municipality_id: municipalityId }, 'Camión agregado.', () => setVehicleForm(current => ({ ...current, unit_number: '', plate: '' })))}><Field label="Número de unidad" value={vehicleForm.unit_number} onChange={unit_number => setVehicleForm({ ...vehicleForm, unit_number })} /><Field label="Patente" value={vehicleForm.plate} onChange={plate => setVehicleForm({ ...vehicleForm, plate })} /><Field label="Descripción" value={vehicleForm.description} onChange={description => setVehicleForm({ ...vehicleForm, description })} /><button className="primary"><Plus /> Agregar camión</button></form></AdminCard><AdminCard title="Unidades registradas" icon={<Truck />}><div className="admin-table"><div className="admin-table-head municipal-fleet-columns"><span>Unidad</span><span>Patente</span><span>Descripción</span><span>Estado</span><span>Acciones</span></div>{vehicles.map(item => <div className="admin-table-row municipal-fleet-columns" key={item.id}><span><b>Unidad {item.unit_number}</b></span><span>{item.plate || '—'}</span><span>{item.description}</span><span><button className={item.active ? 'status-active' : 'status-inactive'} onClick={() => toggleActive('vehicles', item)}>{item.active ? 'Activa' : 'Inactiva'}</button></span><RowActions onEdit={() => editVehicle(item)} onDelete={() => removeItem('vehicles', item, `la unidad ${item.unit_number}`, ' Sus asignaciones también se eliminarán.')} /></div>)}</div></AdminCard></div></>;

  if (section === 'routes') return <><AdminHeading eyebrow="HOJAS DE RUTA" title="Rutas de recolección" subtitle="Definí nombre, zona, días y horarios. El trazado vial se diseña luego desde el mapa." /><div className="screen-two-columns"><AdminCard title="Nueva hoja de ruta" icon={<Route />}><form className="admin-form" onSubmit={create('routes', { ...routeForm, municipality_id: municipalityId }, 'Hoja de ruta creada.', () => setRouteForm(current => ({ ...current, name: '', code: '', zone: '' })))}><Field label="Nombre" value={routeForm.name} onChange={name => setRouteForm({ ...routeForm, name })} /><Field label="Código" value={routeForm.code} onChange={code => setRouteForm({ ...routeForm, code })} /><Field label="Zona o barrio" value={routeForm.zone} onChange={zone => setRouteForm({ ...routeForm, zone })} /><Field label="Días" value={routeForm.schedule_text} onChange={schedule_text => setRouteForm({ ...routeForm, schedule_text })} /><div className="two-fields"><Field label="Inicio" type="time" value={routeForm.starts_at} onChange={starts_at => setRouteForm({ ...routeForm, starts_at })} /><Field label="Fin" type="time" value={routeForm.ends_at} onChange={ends_at => setRouteForm({ ...routeForm, ends_at })} /></div><button className="primary"><Plus /> Crear ruta</button></form></AdminCard><AdminCard title="Hojas de ruta" icon={<Route />}><div className="admin-table"><div className="admin-table-head route-columns"><span>Ruta</span><span>Zona</span><span>Cronograma</span><span>Paradas</span><span>Estado</span><span>Acciones</span></div>{routes.map(item => <div className="admin-table-row route-columns" key={item.id}><span><b>{item.name}</b><small>{item.code}{item.route_path ? ' · Mapa listo' : ' · Sin trazado'}</small></span><span>{item.zone}</span><span>{item.schedule_text || `${item.starts_at}–${item.ends_at}`}</span><span>{stops.filter(stop => stop.route_id === item.id).length}</span><span><button className={item.active ? 'status-active' : 'status-inactive'} onClick={() => toggleActive('routes', item)}>{item.active ? 'Activa' : 'Inactiva'}</button></span><RowActions onEdit={() => editRoute(item)} onDelete={() => removeItem('routes', item, item.name, ' Sus paradas y asignaciones también se eliminarán.')} /></div>)}</div></AdminCard></div></>;

  if (section === 'route-map') return <><AdminHeading eyebrow="MAPA DE RECORRIDO" title="Diseñar recorrido y paradas" subtitle="Marcá puntos de paso, ajustá el trazado a las calles y ubicá las paradas que verá el vecino." />{routes.length ? <><div className="route-map-selector"><Select label="Hoja de ruta a editar" value={selectedRouteId} onChange={setSelectedRouteId} options={routes.map(item => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /><span>{selectedRoute?.route_distance_m ? `${(selectedRoute.route_distance_m / 1000).toFixed(1)} km configurados` : 'Todavía sin recorrido geográfico'}</span></div><RouteDesignerMap route={selectedRoute} stops={stops} municipality={municipality} onSave={saveRouteGeometry} onAddStop={addMapStop} notify={notify} /></> : <div className="admin-empty compact"><MapIcon /><h2>Primero creá una hoja de ruta</h2><p>Después podrás dibujarla sobre el mapa.</p></div>}</>;

  if (section === 'assignments') return <><AdminHeading eyebrow="ASIGNACIONES" title="Asignar rutas a la flota" subtitle="Vinculá cada recorrido geográfico con un camión, un conductor y sus días de operación." /><div className="screen-two-columns assignments-screen"><AdminCard title="Nueva asignación" icon={<ClipboardList />}><form className="admin-form" onSubmit={createAssignment}><Select label="Hoja de ruta" value={assignmentForm.route_id} onChange={route_id => setAssignmentForm({ ...assignmentForm, route_id })} options={routes.map(item => ({ value: item.id, label: `${item.code} · ${item.name}${item.route_path ? '' : ' (sin mapa)'}` }))} /><Select label="Camión" value={assignmentForm.vehicle_id} onChange={vehicle_id => setAssignmentForm({ ...assignmentForm, vehicle_id })} options={vehicles.map(item => ({ value: item.id, label: `Unidad ${item.unit_number} · ${item.plate || 'sin patente'}` }))} /><Select label="Conductor" required={false} value={assignmentForm.driver_id} onChange={driver_id => setAssignmentForm({ ...assignmentForm, driver_id })} options={drivers.map(item => ({ value: item.id, label: item.full_name || 'Conductor' }))} placeholder="Sin conductor fijo" /><Field label="Días (1=lunes, 7=domingo)" value={assignmentForm.weekdays} onChange={weekdays => setAssignmentForm({ ...assignmentForm, weekdays })} /><button className="primary"><Check /> Guardar asignación</button></form></AdminCard><AdminCard title="Asignaciones vigentes" icon={<ClipboardList />}><div className="admin-table"><div className="admin-table-head assignment-columns"><span>Ruta</span><span>Camión</span><span>Conductor</span><span>Días</span><span>Estado</span><span>Acciones</span></div>{assignments.map(item => <div className="admin-table-row assignment-columns" key={item.id}><span><b>{routeById.get(item.route_id)?.name || 'Ruta'}</b><small>{routeById.get(item.route_id)?.route_path ? 'Mapa configurado' : 'Sin mapa'}</small></span><span>Unidad {vehicleById.get(item.vehicle_id)?.unit_number || '—'}</span><span>{driverById.get(item.driver_id)?.full_name || 'Sin conductor fijo'}</span><span>{Array.isArray(item.weekdays) ? item.weekdays.join(', ') : item.weekdays || '—'}</span><span><button className={item.active ? 'status-active' : 'status-inactive'} onClick={() => toggleActive('route_assignments', item)}>{item.active ? 'Activa' : 'Inactiva'}</button></span><RowActions onEdit={() => editAssignment(item)} onDelete={() => removeItem('route_assignments', item, 'esta asignación')} /></div>)}</div></AdminCard></div></>;

  return <><AdminHeading eyebrow="CONDUCTORES" title="Personal de conducción" subtitle="Creá cuentas de conductor y administrá su acceso al municipio." /><div className="screen-two-columns"><AdminCard title="Crear conductor" icon={<UserCog />}><form className="admin-form" onSubmit={addDriver}><Field label="Nombre completo" value={driverForm.full_name} onChange={full_name => setDriverForm({ ...driverForm, full_name })} /><Field label="Correo electrónico" type="email" value={driverForm.email} onChange={email => setDriverForm({ ...driverForm, email })} /><Field label="Contraseña inicial (mínimo 8)" type="password" value={driverForm.password} onChange={password => setDriverForm({ ...driverForm, password })} /><button className="primary"><UserCheck /> Crear y habilitar conductor</button></form></AdminCard><AdminCard title="Conductores habilitados" icon={<Users />}><div className="admin-table"><div className="admin-table-head driver-columns"><span>Nombre</span><span>Asignaciones</span><span>Rol</span><span>Acciones</span></div>{drivers.map(driver => <div className="admin-table-row driver-columns" key={driver.id}><span><b>{driver.full_name || 'Sin nombre'}</b></span><span>{assignments.filter(item => item.driver_id === driver.id && item.active).length} activas</span><span><i className="status-active">Conductor</i></span><span className="user-actions"><button type="button" title="Revocar acceso de conductor" aria-label="Revocar acceso de conductor" onClick={() => revokeDriver(driver)}><UserX /></button></span></div>)}</div></AdminCard></div></>;
}

function AdminHeading({ eyebrow, title, subtitle }) { return <div className="admin-heading"><small>{eyebrow}</small><h1>{title}</h1><p>{subtitle}</p></div>; }
function roleLabel(role) { return ({ neighbor: 'Vecino', driver: 'Conductor', municipal_admin: 'Administrador municipal', platform_admin: 'Administrador de plataforma', admin: 'Administrador de plataforma' })[role] || role; }
function Stat({ icon, value, label }) { return <div>{icon}<span><b>{value}</b><small>{label}</small></span></div>; }
function AdminCard({ title, icon, children, wide }) { return <section className={`admin-card ${wide ? 'wide' : ''}`}><div className="admin-card-title">{icon}<h2>{title}</h2></div>{children}</section>; }
function RowActions({ onEdit, onDelete }) { return <span className="user-actions"><button type="button" title="Editar" aria-label="Editar" onClick={onEdit}><Pencil /></button><button type="button" title="Eliminar" aria-label="Eliminar" onClick={onDelete}><Trash2 /></button></span>; }
function Field({ label, value, onChange, type = 'text', required = !label.includes('(opcional') }) { return <label>{label}<input required={required} type={type} value={value} onChange={event => onChange(event.target.value)} /></label>; }
function Select({ label, value, onChange, options, placeholder = 'Seleccionar…', required = true }) { return <label>{label}<select required={required} value={value} onChange={event => onChange(event.target.value)}><option value="">{placeholder}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }

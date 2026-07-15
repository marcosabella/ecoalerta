import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { Check, LocateFixed, MapPin, Redo2, Route, Save, Trash2, Undo2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [-34.6037, -58.3816];
const toLatLng = coordinates => (coordinates || []).map(([lng, lat]) => [lat, lng]);
const toCoordinates = points => points.map(([lat, lng]) => [lng, lat]);

const truckIcon = running => divIcon({
  className: 'truck-map-marker',
  html: `<span class="${running ? 'is-running' : 'is-stopped'}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M14 9h4l4 4v4h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg></span>`,
  iconSize: [42, 42], iconAnchor: [21, 21], popupAnchor: [0, -23],
});

function ClickHandler({ mode, onRoutePoint, onStopPoint }) {
  useMapEvents({ click: event => mode === 'stop' ? onStopPoint(event.latlng) : onRoutePoint(event.latlng) });
  return null;
}

function FitMap({ points, center }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
    else if (points.length === 1) map.setView(points[0], 16);
    else if (center) map.setView(center, 14);
  }, [map, points, center]);
  return null;
}

function FocusMap({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus?.point) map.setView(focus.point, 16);
  }, [map, focus]);
  return null;
}

export function RouteDesignerMap({ route, stops, municipality, onSave, onAddStop, notify }) {
  const initialCenter = municipality?.map_center_lat != null ? [municipality.map_center_lat, municipality.map_center_lng] : DEFAULT_CENTER;
  const [waypoints, setWaypoints] = useState([]);
  const [path, setPath] = useState([]);
  const [mode, setMode] = useState('route');
  const [stopDraft, setStopDraft] = useState({ name: '', estimated_time: '07:00' });
  const [routing, setRouting] = useState(false);
  const [routeMeta, setRouteMeta] = useState({ distance: null, duration: null });
  const [mapFocus, setMapFocus] = useState(null);

  useEffect(() => {
    const savedPath = toLatLng(route?.route_path?.coordinates);
    const savedWaypoints = toLatLng(route?.route_waypoints || route?.route_path?.coordinates);
    setWaypoints(savedWaypoints); setPath(savedPath); setMode('route');
    setRouteMeta({ distance: route?.route_distance_m || null, duration: route?.route_duration_s || null });
  }, [route?.id]);

  const addRoutePoint = latlng => {
    const point = [latlng.lat, latlng.lng];
    setWaypoints(current => [...current, point]);
    setPath(current => [...current, point]);
  };
  const addStopPoint = async latlng => {
    if (!stopDraft.name.trim()) return notify('Escribí el nombre de la parada antes de ubicarla.');
    await onAddStop({ ...stopDraft, lat: latlng.lat, lng: latlng.lng });
    setStopDraft(current => ({ ...current, name: '' })); setMode('route');
  };
  const useCurrentLocation = () => navigator.geolocation?.getCurrentPosition(position => {
    const point = [position.coords.latitude, position.coords.longitude];
    setMapFocus({ point, requestedAt: Date.now() });
  }, error => notify(error.message), { enableHighAccuracy: true });
  const snapToRoads = async () => {
    if (waypoints.length < 2) return notify('Marcá al menos dos puntos del recorrido.');
    setRouting(true);
    try {
      const coordinates = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`);
      const result = await response.json();
      if (!response.ok || result.code !== 'Ok' || !result.routes?.[0]) throw new Error(result.message || 'No se pudo ajustar el recorrido a las calles.');
      const best = result.routes[0];
      setPath(toLatLng(best.geometry.coordinates)); setRouteMeta({ distance: Math.round(best.distance), duration: Math.round(best.duration) });
      notify('Recorrido ajustado a la red vial.');
    } catch (error) { notify(error.message); }
    finally { setRouting(false); }
  };
  const save = () => {
    if (path.length < 2) return notify('El recorrido necesita al menos dos puntos.');
    onSave({
      route_path: { type: 'LineString', coordinates: toCoordinates(path) },
      route_waypoints: toCoordinates(waypoints),
      route_distance_m: routeMeta.distance,
      route_duration_s: routeMeta.duration,
    });
  };
  const undo = () => {
    const next = waypoints.slice(0, -1); setWaypoints(next); setPath(next); setRouteMeta({ distance: null, duration: null });
  };
  const clear = () => { setWaypoints([]); setPath([]); setRouteMeta({ distance: null, duration: null }); };
  const routeStops = stops.filter(stop => stop.route_id === route?.id && stop.lat != null);

  return <div className="route-designer">
    <div className="route-designer-toolbar">
      <div className="designer-instructions"><Route /><span><b>{route ? `${route.code} · ${route.name}` : 'Seleccioná una hoja de ruta'}</b><small>{mode === 'route' ? (waypoints.length ? 'Seguí marcando los puntos del recorrido.' : 'Hacé clic en el mapa para elegir el inicio del recorrido.') : 'Hacé clic en el punto exacto de la parada.'}</small></span></div>
      <div className="designer-actions"><button className={mode === 'route' ? 'selected' : ''} onClick={() => setMode('route')}><Route /> Trazar</button><button className={mode === 'stop' ? 'selected' : ''} onClick={() => setMode('stop')}><MapPin /> Parada</button><button onClick={undo} disabled={!waypoints.length}><Undo2 /></button><button onClick={clear} disabled={!waypoints.length}><Trash2 /></button></div>
    </div>
    {mode === 'stop' && <div className="stop-map-form"><label>Nombre de parada<input value={stopDraft.name} onChange={event => setStopDraft({ ...stopDraft, name: event.target.value })} placeholder="Ej. Plaza central" /></label><label>Horario estimado<input type="time" value={stopDraft.estimated_time} onChange={event => setStopDraft({ ...stopDraft, estimated_time: event.target.value })} /></label><span><MapPin /> Ahora tocá su ubicación en el mapa</span></div>}
    <MapContainer center={initialCenter} zoom={13} className="leaflet-route-map" scrollWheelZoom>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClickHandler mode={mode} onRoutePoint={addRoutePoint} onStopPoint={addStopPoint} />
      <FitMap points={path} center={initialCenter} />
      <FocusMap focus={mapFocus} />
      {path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#176b4b', weight: 6, opacity: .9 }} />}
      {waypoints.map((point, index) => <CircleMarker key={`${point[0]}-${point[1]}-${index}`} center={point} radius={index === 0 ? 8 : 6} pathOptions={{ color: '#123c2b', fillColor: index === 0 ? '#35a66f' : '#ffcc4d', fillOpacity: 1 }}><Popup>{index === 0 ? 'Inicio del recorrido' : `Punto de paso ${index + 1}`}</Popup></CircleMarker>)}
      {routeStops.map((stop, index) => <CircleMarker key={stop.id} center={[stop.lat, stop.lng]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#d99d17', fillOpacity: 1 }}><Popup><b>{index + 1}. {stop.name}</b><br />{stop.estimated_time?.slice(0, 5)} h</Popup></CircleMarker>)}
    </MapContainer>
    <div className="route-designer-footer"><div><button className="outline" onClick={useCurrentLocation}><LocateFixed /> Centrar en mi ubicación</button><button className="outline" onClick={snapToRoads} disabled={routing || waypoints.length < 2}><Redo2 /> {routing ? 'Calculando…' : 'Ajustar a calles'}</button></div><span>{routeMeta.distance ? `${(routeMeta.distance / 1000).toFixed(1)} km · ${Math.round(routeMeta.duration / 60)} min` : `${waypoints.length} puntos marcados`}</span><button className="primary" onClick={save} disabled={!route || path.length < 2}><Save /> Guardar recorrido</button></div>
  </div>;
}

export function LiveRouteMap({ routePath, navigationPath, routeStart, stops = [], truck, home, running, className = '' }) {
  const path = useMemo(() => toLatLng(routePath?.coordinates), [routePath]);
  const approachPath = useMemo(() => toLatLng(navigationPath?.coordinates), [navigationPath]);
  const points = useMemo(() => {
    const result = [...path, ...approachPath];
    if (truck) result.push([truck.lat, truck.lng]);
    if (home) result.push([home.lat, home.lng]);
    return result;
  }, [path, approachPath, truck, home]);
  const center = points[0] || DEFAULT_CENTER;
  return <div className={`live-route-map ${className}`}><MapContainer center={center} zoom={14} className="leaflet-live-map" scrollWheelZoom><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><FitMap points={points} center={center} />{path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#176b4b', weight: 6, opacity: .85 }} />}{approachPath.length > 1 && <Polyline positions={approachPath} pathOptions={{ color: '#2474c6', weight: 7, opacity: .9 }} />}{routeStart && <CircleMarker center={[routeStart.lat, routeStart.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2474c6', fillOpacity: 1 }}><Popup>Inicio del recorrido</Popup></CircleMarker>}{stops.filter(stop => stop.lat != null).map((stop, index) => <CircleMarker key={stop.id || index} center={[stop.lat, stop.lng]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#d99d17', fillOpacity: 1 }}><Popup>{stop.name}</Popup></CircleMarker>)}{home && <CircleMarker center={[home.lat, home.lng]} radius={10} pathOptions={{ color: '#fff', weight: 3, fillColor: '#e3ae2e', fillOpacity: 1 }}><Popup>Tu domicilio</Popup></CircleMarker>}{truck && <Marker position={[truck.lat, truck.lng]} icon={truckIcon(running)} zIndexOffset={1000}><Popup>Camión recolector{running ? ' · En vivo' : navigationPath ? ' · Hacia el inicio' : ''}</Popup></Marker>}</MapContainer></div>;
}

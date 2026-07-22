const EARTH_RADIUS_M = 6371000;

export function distanceMeters(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

function pointToSegmentDistanceMeters(point, start, end) {
  const referenceLat = (point.lat + start.lat + end.lat) / 3 * Math.PI / 180;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(referenceLat);
  const px = point.lng * metersPerDegreeLng;
  const py = point.lat * metersPerDegreeLat;
  const ax = start.lng * metersPerDegreeLng;
  const ay = start.lat * metersPerDegreeLat;
  const bx = end.lng * metersPerDegreeLng;
  const by = end.lat * metersPerDegreeLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + projection * dx), py - (ay + projection * dy));
}

export function distanceToRouteMeters(point, routePath) {
  if (!point || routePath?.type !== 'LineString' || !Array.isArray(routePath.coordinates) || routePath.coordinates.length < 2) return null;
  let minimum = Infinity;
  for (let index = 1; index < routePath.coordinates.length; index += 1) {
    const previous = routePath.coordinates[index - 1];
    const current = routePath.coordinates[index];
    if (!Array.isArray(previous) || !Array.isArray(current)) continue;
    const [startLng, startLat] = previous.map(Number);
    const [endLng, endLat] = current.map(Number);
    if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) continue;
    minimum = Math.min(minimum, pointToSegmentDistanceMeters(point, { lat: startLat, lng: startLng }, { lat: endLat, lng: endLng }));
  }
  return Number.isFinite(minimum) ? Math.round(minimum) : null;
}

export function relativeMapPosition(home, truck) {
  if (!home || !truck) return { home: { x: 58, y: 48 }, truck: { x: 30, y: 67 } };
  const latScale = 110540;
  const lngScale = 111320 * Math.cos(home.lat * Math.PI / 180);
  const east = (truck.lng - home.lng) * lngScale;
  const north = (truck.lat - home.lat) * latScale;
  const maxOffset = Math.max(500, Math.abs(east), Math.abs(north));
  const scale = 34 / maxOffset;
  return {
    home: { x: 50, y: 50 },
    truck: {
      x: Math.max(10, Math.min(90, 50 + east * scale)),
      y: Math.max(10, Math.min(90, 50 - north * scale)),
    },
  };
}

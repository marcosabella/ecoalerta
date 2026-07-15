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


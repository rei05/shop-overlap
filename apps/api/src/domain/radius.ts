import type { Position } from "@shop-overlap/api-contract";

const EARTH_RADIUS_METERS = 6_371_008.8;
const HALF_EARTH_CIRCUMFERENCE_METERS = Math.PI * EARTH_RADIUS_METERS;
const FULL_LONGITUDE_SPAN = 360;
const POLE_EPSILON_DEGREES = 1e-9;

export type MapBounds = [west: number, south: number, east: number, north: number];

function assertPosition(position: Position, label: string): void {
  if (
    !Array.isArray(position) ||
    position.length !== 2 ||
    !Number.isFinite(position[0]) ||
    !Number.isFinite(position[1])
  ) {
    throw new Error(`${label} must contain two finite longitude and latitude values.`);
  }

  const [longitude, latitude] = position;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error(`${label} must be a valid WGS84 longitude and latitude.`);
  }
}

function assertRadius(radiusMeters: number): void {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error("Radius must be a positive finite number of meters.");
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

/** Normalizes a longitude to the conventional [-180, 180) range. */
function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % FULL_LONGITUDE_SPAN) - 180;
}

/**
 * Returns the point reached by travelling along a great circle from `center`
 * for the specified bearing (clockwise from north) and distance.
 */
function destinationPoint(
  center: Position,
  bearingDegrees: number,
  distanceMeters: number,
): Position {
  const [longitude, latitude] = center;
  const bearing = toRadians(bearingDegrees);
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const latitudeRadians = toRadians(latitude);
  const longitudeRadians = toRadians(longitude);

  const destinationLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance) +
      Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude = longitudeRadians + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
    Math.cos(angularDistance) -
      Math.sin(latitudeRadians) * Math.sin(destinationLatitude),
  );

  return [normalizeLongitude(toDegrees(destinationLongitude)), toDegrees(destinationLatitude)];
}

function unwrapLongitude(longitude: number, relativeTo: number): number {
  return relativeTo + (((longitude - relativeTo + 540) % FULL_LONGITUDE_SPAN) - 180);
}

function circleRing(center: Position, radiusMeters: number, steps: number): Position[] {
  const ring: Position[] = [];
  for (let index = 0; index < steps; index += 1) {
    ring.push(destinationPoint(center, (index * 360) / steps, radiusMeters));
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Returns a conservative, axis-aligned WGS84 bounding box for a distance
 * circle. When the circle crosses the antimeridian or contains a pole, a
 * full-world longitude span is returned because MapBounds cannot represent a
 * wrapped longitude interval safely.
 */
export function circleBounds(center: Position, radiusMeters: number): MapBounds {
  assertPosition(center, "Center");
  assertRadius(radiusMeters);

  if (radiusMeters >= HALF_EARTH_CIRCUMFERENCE_METERS) {
    return [-180, -90, 180, 90];
  }

  const ring = circleRing(center, radiusMeters, 128);
  const latitudes = ring.map((position) => position[1]);
  const south = Math.max(-90, Math.min(...latitudes));
  const north = Math.min(90, Math.max(...latitudes));

  if (north >= 90 - POLE_EPSILON_DEGREES || south <= -90 + POLE_EPSILON_DEGREES) {
    return [-180, south, 180, north];
  }

  const unwrappedLongitudes = ring.map(([longitude]) =>
    unwrapLongitude(longitude, center[0]),
  );
  const west = Math.min(...unwrappedLongitudes);
  const east = Math.max(...unwrappedLongitudes);

  if (west < -180 || east > 180 || east - west >= FULL_LONGITUDE_SPAN - POLE_EPSILON_DEGREES) {
    return [-180, south, 180, north];
  }

  return [west, south, east, north];
}

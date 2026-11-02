const EARTH_METERS_PER_DEGREE = 111_320;
const ROUTE_SAMPLE_STEPS = 36;
const TURN_LOOKAHEAD_METERS = 22;
const CAMERA_LOOKAHEAD_METERS = 70;

const CAMERA_PITCH_KEYFRAMES = Object.freeze([
  Object.freeze({ progress: 0, degrees: -42 }),
  Object.freeze({ progress: 0.1, degrees: -28 }),
  Object.freeze({ progress: 0.28, degrees: -40 }),
  Object.freeze({ progress: 0.72, degrees: -38 }),
  Object.freeze({ progress: 0.88, degrees: -32 }),
  Object.freeze({ progress: 1, degrees: -42 }),
]);

export const CINEMATIC_WAYPOINTS = Object.freeze([
  Object.freeze({ label: "정문 외부 진입", longitude: 127.48368, latitude: 34.96863, height: 138 }),
  Object.freeze({ label: "정문", longitude: 127.48309, latitude: 34.96873, height: 138 }),
  Object.freeze({ label: "운동장 동측 진입", longitude: 127.48225, latitude: 34.96720, height: 134 }),
  Object.freeze({ label: "운동장 상공", longitude: 127.48082, latitude: 34.96655, height: 130 }),
  Object.freeze({ label: "운동장 서측", longitude: 127.47972, latitude: 34.96674, height: 128 }),
  Object.freeze({ label: "기숙사", longitude: 127.47978, latitude: 34.96772, height: 130 }),
  Object.freeze({ label: "서쪽 오르막", longitude: 127.47856, latitude: 34.96842, height: 136 }),
  Object.freeze({ label: "공대 진입", longitude: 127.47730, latitude: 34.96920, height: 140 }),
  Object.freeze({ label: "공대 3호관 서측", longitude: 127.47682, latitude: 34.96974, height: 142 }),
  Object.freeze({ label: "캠퍼스 북서 선회", longitude: 127.47702, latitude: 34.97054, height: 144 }),
  Object.freeze({ label: "공대 상단 훑기", longitude: 127.47752, latitude: 34.97058, height: 142 }),
  Object.freeze({ label: "공대 1호관 우측", longitude: 127.47778, latitude: 34.97016, height: 138 }),
  Object.freeze({ label: "공대 3호관 우측", longitude: 127.47688, latitude: 34.97018, height: 134 }),
  Object.freeze({ label: "도서관", longitude: 127.47802, latitude: 34.96970, height: 130 }),
  Object.freeze({ label: "생명대 접근", longitude: 127.47855, latitude: 34.96962, height: 122 }),
  Object.freeze({ label: "생명대 하강", longitude: 127.47890, latitude: 34.96955, height: 116 }),
]);

function interpolate(value0, value1, value2, value3, progress) {
  const squared = progress * progress;
  const cubed = squared * progress;
  return 0.5 * (
    2 * value1
    + (-value0 + value2) * progress
    + (2 * value0 - 5 * value1 + 4 * value2 - value3) * squared
    + (-value0 + 3 * value1 - 3 * value2 + value3) * cubed
  );
}

function pointOnSegment(segmentIndex, progress) {
  const startIndex = Math.max(0, segmentIndex - 1);
  const endIndex = Math.min(CINEMATIC_WAYPOINTS.length - 1, segmentIndex + 2);
  const point0 = CINEMATIC_WAYPOINTS[startIndex];
  const point1 = CINEMATIC_WAYPOINTS[segmentIndex];
  const point2 = CINEMATIC_WAYPOINTS[segmentIndex + 1];
  const point3 = CINEMATIC_WAYPOINTS[endIndex];
  return {
    longitude: interpolate(point0.longitude, point1.longitude, point2.longitude, point3.longitude, progress),
    latitude: interpolate(point0.latitude, point1.latitude, point2.latitude, point3.latitude, progress),
    height: interpolate(point0.height, point1.height, point2.height, point3.height, progress),
  };
}

function distanceMeters(start, end) {
  const latitudeRadians = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
  const east = (end.longitude - start.longitude) * EARTH_METERS_PER_DEGREE * Math.cos(latitudeRadians);
  const north = (end.latitude - start.latitude) * EARTH_METERS_PER_DEGREE;
  return Math.hypot(east, north);
}

function buildSamples() {
  const samples = [{ ...CINEMATIC_WAYPOINTS[0], distance: 0 }];
  let distance = 0;
  for (let segment = 0; segment < CINEMATIC_WAYPOINTS.length - 1; segment += 1) {
    for (let step = 1; step <= ROUTE_SAMPLE_STEPS; step += 1) {
      const point = pointOnSegment(segment, step / ROUTE_SAMPLE_STEPS);
      distance += distanceMeters(samples.at(-1), point);
      samples.push({ ...point, distance });
    }
  }
  return Object.freeze(samples.map(Object.freeze));
}

const ROUTE_SAMPLES = buildSamples();
export const CINEMATIC_ROUTE_LENGTH_METERS = ROUTE_SAMPLES.at(-1).distance;

function sampleAtDistance(requestedDistance) {
  const distance = Math.min(CINEMATIC_ROUTE_LENGTH_METERS, Math.max(0, requestedDistance));
  let low = 0;
  let high = ROUTE_SAMPLES.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (ROUTE_SAMPLES[middle].distance < distance) low = middle;
    else high = middle;
  }
  const start = ROUTE_SAMPLES[low];
  const end = ROUTE_SAMPLES[high];
  const span = end.distance - start.distance;
  const progress = span === 0 ? 0 : (distance - start.distance) / span;
  return {
    longitude: start.longitude + (end.longitude - start.longitude) * progress,
    latitude: start.latitude + (end.latitude - start.latitude) * progress,
    height: start.height + (end.height - start.height) * progress,
  };
}

function headingBetween(start, end) {
  const latitudeRadians = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
  const east = (end.longitude - start.longitude) * Math.cos(latitudeRadians);
  const north = end.latitude - start.latitude;
  return Math.atan2(east, north) * 180 / Math.PI;
}

function angleDelta(start, end) {
  return ((end - start + 540) % 360) - 180;
}

function cameraPitch(progress) {
  const endIndex = CAMERA_PITCH_KEYFRAMES.findIndex((frame) => frame.progress >= progress);
  if (endIndex <= 0) return CAMERA_PITCH_KEYFRAMES[0].degrees;
  const start = CAMERA_PITCH_KEYFRAMES[endIndex - 1];
  const end = CAMERA_PITCH_KEYFRAMES[endIndex];
  const localProgress = (progress - start.progress) / (end.progress - start.progress);
  return start.degrees + (end.degrees - start.degrees) * localProgress;
}

export function cinematicPose(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  const distance = CINEMATIC_ROUTE_LENGTH_METERS * clamped;
  const position = sampleAtDistance(distance);
  const before = sampleAtDistance(distance - 6);
  const after = sampleAtDistance(distance + 6);
  const cameraTarget = sampleAtDistance(distance + CAMERA_LOOKAHEAD_METERS);
  const turnBefore = sampleAtDistance(distance - TURN_LOOKAHEAD_METERS);
  const turnAfter = sampleAtDistance(distance + TURN_LOOKAHEAD_METERS);
  const headingDegrees = distance + CAMERA_LOOKAHEAD_METERS >= CINEMATIC_ROUTE_LENGTH_METERS
    ? headingBetween(before, after)
    : headingBetween(position, cameraTarget);
  const turnDegrees = angleDelta(headingBetween(turnBefore, position), headingBetween(position, turnAfter));
  return {
    ...position,
    progress: clamped,
    headingDegrees,
    pitchDegrees: cameraPitch(clamped),
    rollDegrees: Math.min(4, Math.max(-4, turnDegrees * 0.16)),
  };
}

// Playback gate shared by the animated live layers (E2Worksite.jsx, MedPromo.jsx): a layer animates only while the
// canvas is on screen, the page is visible, reduced motion is off and nothing covers the campus, and only when its
// anchor point is near the camera and inside the view. Each check that changes asks the demand loop for a frame.
export function attachLayerPlayback(gl, invalidate, win = globalThis.window) {
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
  const state = { motion, inView: true };
  const observer = new IntersectionObserver(([entry]) => {
    state.inView = entry.isIntersecting;
    invalidate();
  });
  observer.observe(gl.domElement);
  const changed = () => invalidate();
  motion.addEventListener("change", changed);
  win.document.addEventListener("visibilitychange", changed);
  state.dispose = () => {
    observer.disconnect();
    win.document.removeEventListener("visibilitychange", changed);
    motion.removeEventListener("change", changed);
  };
  return state;
}

export const layerPaused = (state, obscured) => obscured || !state.inView || document.hidden || state.motion.matches;

// Whether a world point (a three.js Vector3, overwritten by the projection) is within maxDistance of the camera and
// inside its view.
export function pointInView(point, camera, maxDistance) {
  if (point.distanceToSquared(camera.position) > maxDistance ** 2) return false;
  point.project(camera);
  return Math.abs(point.x) <= 1.05 && Math.abs(point.y) <= 1.05 && Math.abs(point.z) <= 1;
}

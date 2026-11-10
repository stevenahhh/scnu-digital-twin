export function renderPorts(env = process.env) {
  const ports = {};
  for (const [name, key, fallback] of [
    ["server", "MODEL_QA_PORT", 5242],
    ["devtools", "MODEL_QA_DEVTOOLS_PORT", 9382],
  ]) {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new RangeError(`${key} must be an integer port from 1 to 65535`);
    }
    ports[name] = value;
  }
  if (ports.server === ports.devtools) throw new RangeError("QA server and DevTools ports must be distinct");
  return ports;
}

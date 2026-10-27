// 다각형(3D 꼭짓점)을 ahead(p) >= 0인 쪽으로 자른다(Sutherland-Hodgman). 카메라 뒤 꼭짓점을 투영하면 화면 안으로 뒤집힌다.
export function clipPolygonAhead(points, ahead) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const da = ahead(a);
    const db = ahead(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push(a.map((value, axis) => value + (b[axis] - value) * t));
    }
  }
  return out;
}

// Orthophoto ground albedo (BUILD-PLAN U44, with the VWorld z19 mosaic of lib/ortho.mjs under consent D1).
//
// composeOrthoGround() turns the procedural ground raster that stages/ground.mjs paints into the photo ground:
//   1. The mosaic is resampled bilinearly into the raster's model frame.
//   2. What the model draws itself must not stay in the photo, or it doubles up:
//      - buildings: every modelled footprint plus a margin that grows with the building's height, because roof
//        edges and facades lean outward in the photo (relief displacement; ASSUMED 0.6 m + 3 % of the height);
//      - crowns: the ground under a modelled tree crown (plus CROWN_MARGIN_M) that stands in the open, and photo
//        vegetation over the surfaces the generator paints as paving (street trees over roads, walkways and
//        plazas, where the model has no tree). Inside groves (modelled crowns cover at least GROVE_DENSITY of
//        the ground within GROVE_RADIUS_M) the photo canopy stays, crowns, gaps and shade alike: it fills the
//        gaps between the modelled crowns the way the real canopy does;
//      - shadows: the photo was taken in the morning (shadows fall west-north-west) and the dashboard casts its
//        own shadows for its clock, so cast shadows on open ground are relit. The shadow mask is grown by
//        SHADOW_GROW_PX so the penumbra is relit with it and leaves no dark rim.
//   3. Fills are class-aware: every pixel has a surface class from the procedural painting (natural ground,
//      light paving, asphalt, painted sports surfaces, off-campus lots; building footprints count as light
//      paving). A filled pixel takes the local mean photo colour of its class over the unmasked, lit pixels
//      around it (LOCAL_RADIUS_M, falling back to WIDE_RADIUS_M, then to the class mean over the whole raster),
//      modulated by the procedural layer's luminance relative to its class mean (FILL_DETAIL), so a walkway under
//      a tree is walkway-coloured. A relit shadow pixel takes the same lit class colour times the photo's own
//      high-pass luminance (luminance over its DETAIL_RADIUS_PX box mean, SHADOW_DETAIL), so markings and kerbs
//      inside a shadow survive while the shadow's darkness does not. Edges are feathered over FEATHER_PX.
//   4. Colour: white balance from bright, nearly grey photo pixels (roof membranes and concrete read cyan in the
//      mosaic) and a tone lift to albedo, in linear light (photoCalibration, also used for the roof colours).
// Everything here is an estimate derived from imagery, not a measurement of surface albedo.
import { Raster } from "./raster.mjs";

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const LINEAR_STEPS = 4095;
const LINEAR_TO_SRGB = Uint8Array.from({ length: LINEAR_STEPS + 1 }, (_, i) => {
  const v = i / LINEAR_STEPS;
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
});
const toLinear = (c) => SRGB_TO_LINEAR[Math.max(0, Math.min(255, Math.round(c)))];
const toSrgb = (v) => LINEAR_TO_SRGB[Math.round((v <= 0 ? 0 : v >= 1 ? 1 : v) * LINEAR_STEPS)];
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---------------------------------------------------------------- colour calibration
// White-balance reference: photo pixels at least WB_MIN_LUMA bright whose channels differ by at most
// WB_MAX_SPREAD (sRGB) and are not clipped. Albedo: the mosaic's tone curve keeps white membranes near their
// albedo (linear about 0.7) but crushes mid-tones (lawn 0.07, asphalt 0.09, concrete paving 0.14 in linear
// light, against typical albedos of about 0.2, 0.15 and 0.3), so after the white balance the linear value is
// lifted by the power 1 / ALBEDO_GAMMA (ASSUMED 1.5: lawn 0.17, asphalt 0.20, paving 0.27, membranes 0.77; checked
// with scripts/perf/compare-satellite.mjs at noon). These are estimates, not measured albedos.
const WB_MIN_LUMA = 170;
const WB_MAX_SPREAD = 36;
const ALBEDO_GAMMA = 1.5;

export function photoCalibration(ortho) {
  const picks = [[], [], []];
  const { rgb } = ortho;
  for (let i = 0; i < rgb.length; i += 3 * 7) {
    const r = rgb[i];
    const g = rgb[i + 1];
    const b = rgb[i + 2];
    if (luma(r, g, b) >= WB_MIN_LUMA && Math.max(r, g, b) - Math.min(r, g, b) <= WB_MAX_SPREAD && Math.max(r, g, b) < 250) {
      picks[0].push(r);
      picks[1].push(g);
      picks[2].push(b);
    }
  }
  if (picks[0].length < 1000) throw new Error(`ortho white balance: only ${picks[0].length} bright neutral pixels`);
  const reference = picks.map((values) => values.sort((a, b) => a - b)[values.length >> 1]);
  const linear = reference.map(toLinear);
  const mean = (linear[0] + linear[1] + linear[2]) / 3;
  const gains = linear.map((v) => mean / v);
  // Linear photo value -> linear albedo estimate, and raw photo sRGB -> albedo sRGB, per channel.
  const albedo = (value, channel) => Math.min(1, Math.max(0, value * gains[channel])) ** (1 / ALBEDO_GAMMA);
  const lut = gains.map((_, channel) => Uint8Array.from({ length: 256 }, (__, c) => toSrgb(albedo(SRGB_TO_LINEAR[c], channel))));
  return { reference, gains, gamma: ALBEDO_GAMMA, samples: picks[0].length, lut, albedo, calibrate: (c, channel) => lut[channel][Math.max(0, Math.min(255, Math.round(c)))] };
}

// ---------------------------------------------------------------- photo classes (raw mosaic values)
// Vegetation: normalised excess green (2G - R - B) / (R + G + B) above VEG_EXG (lawn about 0.26, crowns 0.32,
// pavers 0.10, asphalt 0.09, roofs 0.03 in this mosaic). Cast shadow: the mosaic's red channel drops to
// almost 0 in shadow (asphalt 64 lit, 7 in shadow) while haze keeps green and blue up, so the shadow weight
// ramps from 0 at SHADOW_RED[1] / SHADOW_LUMA[1] to 1 at SHADOW_RED[0] / SHADOW_LUMA[0].
export const VEG_EXG = 0.15;
const SHADOW_RED = [14, 30];
const SHADOW_LUMA = [48, 72];
export const excessGreen = (r, g, b) => (2 * g - r - b) / (r + g + b + 1);
export function shadowWeight(r, g, b) {
  const red = (SHADOW_RED[1] - r) / (SHADOW_RED[1] - SHADOW_RED[0]);
  const dark = (SHADOW_LUMA[1] - luma(r, g, b)) / (SHADOW_LUMA[1] - SHADOW_LUMA[0]);
  return Math.max(0, Math.min(1, red)) * Math.max(0, Math.min(1, dark));
}

// Surface classes of the procedural raster (stages/ground.mjs writes them into its labels).
export const SURFACE_CLASS = Object.freeze({ NATURAL: 0, PAVING: 1, ASPHALT: 2, PAINTED: 3, LOT: 4 });
const CLASS_COUNT = 5;

// ---------------------------------------------------------------- composition
const BUILDING_MARGIN_M = 0.6;
const BUILDING_LEAN = 0.03; // metres of margin per metre of height
const CROWN_MARGIN_M = 0.4;
const GROVE_RADIUS_M = 8;
const GROVE_DENSITY = 0.6;
const BLOCK = 4; // pixels per statistics block (about 1 m at 0.25 m per pixel)
const LOCAL_RADIUS_M = 5;
const WIDE_RADIUS_M = 20;
const MIN_LOCAL_PIXELS = 64; // valid pixels of the class a window needs before its mean is trusted
const FILL_DETAIL = 0.5;
const FILL_DETAIL_RANGE = [0.75, 1.25];
const SHADOW_CORE = 0.3; // shadow weight that marks a pixel as cast shadow before growing
const SHADOW_GROW_PX = 2;
const SHADOW_DETAIL = 0.8;
const SHADOW_DETAIL_RANGE = [0.6, 1.5];
const DETAIL_RADIUS_PX = 4;
const FEATHER_PX = 2;

// Box mean of a one-channel Float32 image over (2r + 1)^2 pixels (edge windows shrink), via running sums.
function boxMean(values, width, height, r) {
  const horizontal = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, width - 1); x += 1) sum += values[row + x];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / (Math.min(width - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < width) sum += values[row + x + r + 1];
      if (x - r >= 0) sum -= values[row + x - r];
    }
  }
  const out = new Float32Array(values.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, height - 1); y += 1) sum += horizontal[y * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / (Math.min(height - 1, y + r) - Math.max(0, y - r) + 1);
      if (y + r + 1 < height) sum += horizontal[(y + r + 1) * width + x];
      if (y - r >= 0) sum -= horizontal[(y - r) * width + x];
    }
  }
  return out;
}

// One-channel mask painted with Raster's polygon, stroke and disc fills.
function maskRaster(width, height) {
  const data = new Uint8Array(width * height);
  const target = {
    width,
    height,
    set(x, y) {
      if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = 1;
    },
    fillPolygon: Raster.prototype.fillPolygon,
    fillDisc: Raster.prototype.fillDisc,
    strokePolyline: Raster.prototype.strokePolyline,
  };
  const one = () => null;
  return {
    data,
    fill: (rings) => target.fillPolygon(rings, one),
    stroke: (points, width) => target.strokePolyline(points, width, one),
    disc: (cx, cy, radius) => target.fillDisc(cx, cy, radius, one),
  };
}

// Summed-area table over a (bw x bh) grid; returns sum over the window of radius r blocks around (x, y).
function boxSummer(values, bw, bh) {
  const table = new Float64Array((bw + 1) * (bh + 1));
  for (let y = 0; y < bh; y += 1) {
    let row = 0;
    for (let x = 0; x < bw; x += 1) {
      row += values[y * bw + x];
      table[(y + 1) * (bw + 1) + x + 1] = table[y * (bw + 1) + x + 1] + row;
    }
  }
  return (x, y, r) => {
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(bw, x + r + 1);
    const y1 = Math.min(bh, y + r + 1);
    return table[y1 * (bw + 1) + x1] - table[y0 * (bw + 1) + x1] - table[y1 * (bw + 1) + x0] + table[y0 * (bw + 1) + x0];
  };
}

// Per block: mean of `sums` (channels arrays) over `count`, from the local window, else the wide one, else
// `fallback` (per channel), blended by how many samples each window holds.
function localMeans(sums, count, bw, bh, local, wide, fallback) {
  const channels = sums.length;
  const out = new Float32Array(bw * bh * channels);
  const sumBoxes = sums.map((values) => boxSummer(values, bw, bh));
  const countBox = boxSummer(count, bw, bh);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      const k = by * bw + bx;
      const nLocal = countBox(bx, by, local);
      const nWide = countBox(bx, by, wide);
      const wLocal = Math.min(1, nLocal / MIN_LOCAL_PIXELS);
      const wWide = Math.min(1, nWide / MIN_LOCAL_PIXELS);
      for (let ch = 0; ch < channels; ch += 1) {
        const mLocal = nLocal > 0 ? sumBoxes[ch](bx, by, local) / nLocal : 0;
        const mWide = nWide > 0 ? sumBoxes[ch](bx, by, wide) / nWide : 0;
        const far = mWide * wWide + fallback[ch] * (1 - wWide);
        out[k * channels + ch] = mLocal * wLocal + far * (1 - wLocal);
      }
    }
  }
  return out;
}

// ground: the procedural Raster (sRGB), overwritten with the composite. classes[p]: SURFACE_CLASS per pixel.
// toPixel([x, z]) maps model units to raster pixels and pixelCentre(px, py) back; metresPerPixel and
// unitsPerPixel give the raster scale. buildings: [{ parts: [{ outer, holes, heightMetres }] }]; crowns:
// [{ x, z, radius }] in model units. Returns build-log stats.
export function composeOrthoGround({ ground, classes, ortho, calibration, toPixel, pixelCentre, metresPerPixel, unitsPerPixel, buildings, crowns }) {
  const { width, height } = ground;
  const size = width * height;
  const pxPerMetre = 1 / metresPerPixel;

  // 1. photo in the raster frame
  const photo = new Uint8Array(size * 3);
  {
    const cols = Float64Array.from({ length: width }, (_, x) => ortho.col(pixelCentre(x, 0)[0]));
    const rows = Float64Array.from({ length: height }, (_, y) => ortho.row(pixelCentre(0, y)[1]));
    const { rgb } = ortho;
    for (let y = 0; y < height; y += 1) {
      const fy = Math.min(ortho.height - 1.001, Math.max(0, rows[y] - 0.5));
      const iy = Math.floor(fy);
      const ty = fy - iy;
      for (let x = 0; x < width; x += 1) {
        const fx = Math.min(ortho.width - 1.001, Math.max(0, cols[x] - 0.5));
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const a = (iy * ortho.width + ix) * 3;
        const c = a + ortho.width * 3;
        const i = (y * width + x) * 3;
        for (let ch = 0; ch < 3; ch += 1) {
          photo[i + ch] = (rgb[a + ch] * (1 - tx) + rgb[a + 3 + ch] * tx) * (1 - ty) + (rgb[c + ch] * (1 - tx) + rgb[c + 3 + ch] * tx) * ty + 0.5;
        }
      }
    }
  }

  // 2. masks: kind 0 photo, 1 fill, 2 relit shadow, 3 photo kept inside a grove
  const building = maskRaster(width, height);
  for (const { parts } of buildings) {
    for (const part of parts) {
      const marginPx = (BUILDING_MARGIN_M + BUILDING_LEAN * part.heightMetres) * pxPerMetre;
      building.fill([part.outer.map(toPixel)]);
      for (const ring of [part.outer, ...part.holes]) building.stroke([...ring, ring[0]].map(toPixel), 2 * marginPx);
    }
  }
  const crown = maskRaster(width, height);
  const crownMarginPx = CROWN_MARGIN_M * pxPerMetre;
  for (const tree of crowns) {
    const [cx, cy] = toPixel([tree.x, tree.z]);
    crown.disc(cx, cy, tree.radius / unitsPerPixel + crownMarginPx);
  }
  const bw = Math.ceil(width / BLOCK);
  const bh = Math.ceil(height / BLOCK);
  const blocks = bw * bh;
  // grove density per block: share of crown pixels within GROVE_RADIUS_M
  const groveDensity = new Float32Array(blocks);
  {
    const crownCount = new Float32Array(blocks);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) if (crown.data[y * width + x]) crownCount[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)] += 1;
    }
    const box = boxSummer(crownCount, bw, bh);
    const r = Math.max(1, Math.round((GROVE_RADIUS_M * pxPerMetre) / BLOCK));
    for (let by = 0; by < bh; by += 1) {
      for (let bx = 0; bx < bw; bx += 1) {
        const area = (Math.min(bw, bx + r + 1) - Math.max(0, bx - r)) * (Math.min(bh, by + r + 1) - Math.max(0, by - r)) * BLOCK * BLOCK;
        groveDensity[by * bw + bx] = box(bx, by, r) / area;
      }
    }
  }
  const cell = (fx, fy) => {
    const gx = Math.min(bw - 1.001, Math.max(0, fx / BLOCK - 0.5));
    const gy = Math.min(bh - 1.001, Math.max(0, fy / BLOCK - 0.5));
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    return [iy * bw + ix, gx - ix, gy - iy];
  };
  const lerpBlock = (values, channels, k00, tx, ty, ch) => {
    const k10 = k00 + 1;
    const k01 = k00 + bw;
    const k11 = k01 + 1;
    return (values[k00 * channels + ch] * (1 - tx) + values[k10 * channels + ch] * tx) * (1 - ty) +
      (values[k01 * channels + ch] * (1 - tx) + values[k11 * channels + ch] * tx) * ty;
  };
  const kind = new Uint8Array(size);
  const surface = new Uint8Array(size);
  const counts = { building: 0, crown: 0, street: 0, grove: 0, shadow: 0 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const r = photo[p * 3];
      const g = photo[p * 3 + 1];
      const b = photo[p * 3 + 2];
      surface[p] = building.data[p] ? SURFACE_CLASS.PAVING : classes[p];
      const [k00, tx, ty] = cell(x + 0.5, y + 0.5);
      const grove = lerpBlock(groveDensity, 1, k00, tx, ty, 0) >= GROVE_DENSITY;
      if (building.data[p]) {
        kind[p] = 1;
        counts.building += 1;
      } else if ((classes[p] === SURFACE_CLASS.PAVING || classes[p] === SURFACE_CLASS.ASPHALT) && excessGreen(r, g, b) > VEG_EXG) {
        kind[p] = 1;
        counts.street += 1;
      } else if (grove) {
        kind[p] = 3;
        counts.grove += 1;
      } else if (crown.data[p]) {
        kind[p] = 1;
        counts.crown += 1;
      } else if (shadowWeight(r, g, b) >= SHADOW_CORE) {
        kind[p] = 2;
      }
    }
  }
  // grow the shadows over the penumbra (photo pixels only)
  for (let pass = 0; pass < SHADOW_GROW_PX; pass += 1) {
    const grown = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (kind[p] !== 0) continue;
        if ((x > 0 && kind[p - 1] === 2) || (x + 1 < width && kind[p + 1] === 2) || (y > 0 && kind[p - width] === 2) || (y + 1 < height && kind[p + width] === 2)) grown.push(p);
      }
    }
    for (const p of grown) kind[p] = 2;
  }
  for (let p = 0; p < size; p += 1) if (kind[p] === 2) counts.shadow += 1;

  // 3. per class: local mean lit photo colour (linear) per block
  const local = Math.max(1, Math.round((LOCAL_RADIUS_M * pxPerMetre) / BLOCK));
  const wide = Math.max(local + 1, Math.round((WIDE_RADIUS_M * pxPerMetre) / BLOCK));
  const g = ground.data;
  const litMeans = [];
  const groundMeanLuma = new Float64Array(CLASS_COUNT);
  for (let cls = 0; cls < CLASS_COUNT; cls += 1) {
    const sums = [new Float32Array(blocks), new Float32Array(blocks), new Float32Array(blocks)];
    const count = new Float32Array(blocks);
    const total = [0, 0, 0];
    let totalCount = 0;
    let groundLuma = 0;
    let groundCount = 0;
    for (let y = 0; y < height; y += 1) {
      const by = Math.floor(y / BLOCK) * bw;
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (surface[p] !== cls) continue;
        const i = p * 3;
        groundLuma += luma(SRGB_TO_LINEAR[g[i]], SRGB_TO_LINEAR[g[i + 1]], SRGB_TO_LINEAR[g[i + 2]]);
        groundCount += 1;
        if (kind[p] !== 0) continue;
        const k = by + Math.floor(x / BLOCK);
        for (let ch = 0; ch < 3; ch += 1) {
          const v = SRGB_TO_LINEAR[photo[i + ch]];
          sums[ch][k] += v;
          total[ch] += v;
        }
        count[k] += 1;
        totalCount += 1;
      }
    }
    groundMeanLuma[cls] = groundCount ? groundLuma / groundCount : 1;
    const fallback = totalCount ? total.map((v) => v / totalCount) : [0.1, 0.1, 0.1];
    litMeans.push(localMeans(sums, count, bw, bh, local, wide, fallback));
  }
  // photo luminance and its DETAIL_RADIUS_PX box mean, for the high-pass detail of relit shadows
  const photoLuma = new Float32Array(size);
  for (let p = 0; p < size; p += 1) photoLuma[p] = luma(SRGB_TO_LINEAR[photo[p * 3]], SRGB_TO_LINEAR[photo[p * 3 + 1]], SRGB_TO_LINEAR[photo[p * 3 + 2]]);
  const photoLumaMean = boxMean(photoLuma, width, height, DETAIL_RADIUS_PX);
  // replacement weights: the fill and shadow masks box-blurred over FEATHER_PX (1 inside), so edges fade
  const weightOf = (target) => {
    const binary = new Float32Array(size);
    for (let p = 0; p < size; p += 1) binary[p] = kind[p] === target ? 1 : 0;
    const blurred = boxMean(binary, width, height, FEATHER_PX);
    for (let p = 0; p < size; p += 1) if (binary[p]) blurred[p] = 1;
    return blurred;
  };
  const fillWeight = weightOf(1);
  const shadowWeights = weightOf(2);

  // 4. composite (linear light), then the calibration
  const { lut, albedo } = calibration;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 3;
      const fillW = fillWeight[p];
      const shadowW = shadowWeights[p];
      if (fillW === 0 && shadowW === 0) {
        g[i] = lut[0][photo[i]];
        g[i + 1] = lut[1][photo[i + 1]];
        g[i + 2] = lut[2][photo[i + 2]];
        continue;
      }
      const cls = surface[p];
      const [k00, tx, ty] = cell(x + 0.5, y + 0.5);
      const lit = litMeans[cls];
      const groundLuma = luma(SRGB_TO_LINEAR[g[i]], SRGB_TO_LINEAR[g[i + 1]], SRGB_TO_LINEAR[g[i + 2]]);
      const fillDetail = Math.max(FILL_DETAIL_RANGE[0], Math.min(FILL_DETAIL_RANGE[1], 1 + FILL_DETAIL * (groundLuma / groundMeanLuma[cls] - 1)));
      const mean = photoLumaMean[p];
      const shadowDetail = mean > 0 ? Math.max(SHADOW_DETAIL_RANGE[0], Math.min(SHADOW_DETAIL_RANGE[1], 1 + SHADOW_DETAIL * (photoLuma[p] / mean - 1))) : 1;
      const weight = Math.min(1, fillW + shadowW);
      const detail = (fillW * fillDetail + shadowW * shadowDetail) / (fillW + shadowW);
      for (let ch = 0; ch < 3; ch += 1) {
        const fill = lerpBlock(lit, 3, k00, tx, ty, ch) * detail;
        const value = SRGB_TO_LINEAR[photo[i + ch]] * (1 - weight) + fill * weight;
        g[i + ch] = toSrgb(albedo(value, ch));
      }
    }
  }
  return {
    width,
    height,
    metresPerPixel,
    shares: Object.fromEntries(Object.entries(counts).map(([key, n]) => [key, n / size])),
  };
}

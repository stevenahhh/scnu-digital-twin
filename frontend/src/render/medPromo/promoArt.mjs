// Copy and artwork of the 의대 유치 promo layer (render/MedPromo.jsx): the posters on the campus banner boards, the
// slides of the LED screen over the gate letter sign and the picket text of the marchers
// (scripts/campus-model/med-promo.mjs). Every line quotes or restates a recorded public source (PROMO_SOURCES).
// The drawing helpers take a 2D canvas context, so this module has no DOM or three.js import.

export const PROMO_SOURCES = Object.freeze({
  korea: { title: "대한민국 정책브리핑: 국립순천대·국립경국대 의대 신설, 2030년 첫 문 열어 (2026-11-04)", url: "https://www.korea.kr/news/policyNewsView.do?newsId=148974975" },
  ynaConfirm: { title: "연합뉴스: 전남광주 국립 의대 신설 확정, 36년 숙원 해결 (2026-11-04)", url: "https://www.yna.co.kr/view/AKR20261103152600054" },
  ajunews: { title: "아주경제: 청소차량 60대에 '100만 지역민의 꿈 순천대 의과대학 신설' 현수막 (2024-05-13)", url: "https://www.ajunews.com/view/20240513164454683" },
  suncheonnews: { title: "여순광뉴스: 순천시의회 유치 촉구 피켓 퍼포먼스, '84만 동부권 주민의 의료주권' (2026-08-14)", url: "https://www.suncheonnews.kr/articles/2026081409037" },
  scnuConfirm: { title: "국립순천대학교: 국립의과대학 신설 최종 확정 (2026-11-04)", url: "https://www.scnu.ac.kr/SCNU/na/ntt/selectNttInfo.do?nttSn=281323695" },
  scnuRally: { title: "국립순천대학교: 의과대학 설립 촉구 성명·범시민 궐기대회 (2026-08-03)", url: "https://www.scnu.ac.kr/SCNU/na/ntt/selectNttInfo.do?nttSn=281316587" },
  sdtime: { title: "해룡신문: 범시민추진위 성명 「이제, 그 말을 듣지 않도록」, 2032년 대학병원 개원 목표 (2026-11-07)", url: "https://www.sdtime.net/article/scnu-medical-civic-committee-statement-2026" },
  herald: { title: "헤럴드경제: 왕의산 자락 시유지 15만1719㎡, 부속 종합병원 500병상급 (2026-09-01)", url: "https://biz.heraldcorp.com/article/10858652" },
  seoul: { title: "서울신문(다음): 드라마촬영장 뒤편 비례골 일대 시유지에 의대·대학병원 (2026-08-31)", url: "https://v.daum.net/v/1QLDUdYCWq?f=p" },
  tf: { title: "더팩트: 조례동 산 13-3 일원 옛 군부대 부지 (2026-08-31)", url: "https://news.tf.co.kr/read/national/2360108.htm" },
  suncheonSign: { title: "순천시청: 순천의대유치 서명운동 '순천의대유치를 지지합니다'", url: "https://www.suncheon.go.kr/kr/talk/0013/" },
  namdo: { title: "남도일보: 범시민 결의대회 1천여 명, 삼보일배 (2026-08-30)", url: "https://www.namdonews.com/news/articleView.html?idxno=921620" },
});

// Campus banner posters, one design per board in turn (scripts/campus-model/medPromo/layout.mjs).
export const POSTER_DESIGNS = Object.freeze([
  {
    id: "confirmed",
    kicker: "36년 숙원 · 2026.11.4 확정",
    lines: ["국립순천대학교", "의과대학 신설 확정!"],
    sub: "의대 정원 60명 · 2030학년도 첫 신입생",
    footer: "84만 동부권 주민의 의료주권",
    palette: { bg0: "#0f2a5c", bg1: "#1d4e9e", ink: "#ffffff", accent: "#ffd34d", band: "#e2382f" },
    sources: ["korea", "ynaConfirm", "suncheonnews"],
  },
  {
    id: "dream",
    kicker: "의대 유치 성공",
    lines: ["100만 지역민의 꿈", "순천대 의과대학"],
    sub: "부속병원 500병상급 · 2032년 개원 목표",
    footer: "시민과 함께한 간절한 숙원의 결실",
    palette: { bg0: "#ffffff", bg1: "#e8f3ff", ink: "#0f2a5c", accent: "#e2382f", band: "#1d4e9e" },
    sources: ["ajunews", "herald", "sdtime", "scnuConfirm"],
  },
  {
    id: "never-again",
    kicker: "범시민추진위원회 성명",
    lines: ["“여기서는 안 됩니다”", "그 말, 이제 그만"],
    sub: "「이제, 그 말을 듣지 않도록」",
    footer: "지역 소멸을 막고 의료 주권을 확보하자",
    palette: { bg0: "#0b6e69", bg1: "#14a39a", ink: "#ffffff", accent: "#fff1a8", band: "#0f2a5c" },
    sources: ["sdtime", "scnuRally"],
  },
]);

export const SLIDE_SECONDS = 4;
export const TRANSITION_SECONDS = 0.6;
export const TICKER_SECONDS = 22;

export const SCREEN_SLIDES = Object.freeze([
  { kicker: "경축", title: "국립순천대학교 의과대학 신설 확정", sub: "2026.11.4 교육부·보건복지부 발표", tone: "#ffd34d", sources: ["korea"] },
  { kicker: "정원 배정", title: "의대 정원 60명", sub: "2030학년도 첫 신입생 선발", tone: "#7fe3ff", sources: ["korea"] },
  { kicker: "의대 유치 성공", title: "100만 지역민의 꿈, 이루었습니다", sub: "36년 숙원 전남권 국립의대", tone: "#ff8f7a", sources: ["ajunews", "ynaConfirm"] },
  { kicker: "의료주권", title: "84만 동부권 주민과 함께", sub: "시민과 함께한 간절한 숙원의 결실", tone: "#b8ff8a", sources: ["suncheonnews", "scnuConfirm"] },
  { kicker: "대학병원", title: "부속병원 500병상급", sub: "2032년 대학병원 개원 목표", tone: "#ffd34d", sources: ["herald", "sdtime"] },
  { kicker: "예정 부지", title: "조례동 드라마촬영장 인근 15만㎡", sub: "의대·대학병원 부지 · 조례동 산 13-3 일원", tone: "#7fe3ff", sources: ["seoul", "tf"] },
]);

export const SCREEN_TICKER = Object.freeze({
  text: "국립순천대학교 의과대학 유치 성공  ·  「이제, 그 말을 듣지 않도록」  ·  순천의대유치를 지지합니다  ·  지역 소멸을 막고 의료 주권을 확보하자  ·  ",
  sources: ["sdtime", "suncheonSign", "scnuRally"],
});

// The marchers' picket, two lines of extruded letters (scripts/campus-model/med-promo.mjs).
export const PICKET_LINES = Object.freeze({ lines: ["의대 유치", "성공!"], sources: ["korea", "suncheonnews"] });

const frac = (x) => x - Math.floor(x);

// The slide on screen at t seconds, the next one and the cross-fade towards it (0 while the slide holds), plus the
// ticker position as a fraction of one pass.
export function screenFrame(t) {
  const count = SCREEN_SLIDES.length;
  const local = frac(t / (SLIDE_SECONDS * count)) * SLIDE_SECONDS * count;
  const slide = Math.min(count - 1, Math.floor(local / SLIDE_SECONDS));
  const into = local - slide * SLIDE_SECONDS;
  const fadeStart = SLIDE_SECONDS - TRANSITION_SECONDS;
  return {
    slide,
    next: (slide + 1) % count,
    mix: into > fadeStart ? (into - fadeStart) / TRANSITION_SECONDS : 0,
    ticker: frac(t / TICKER_SECONDS),
  };
}

export const PROMO_FONT = '"Wanted Sans Variable", "Wanted Sans", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const font = (weight, px) => `${weight} ${Math.round(px)}px ${PROMO_FONT}`;

// Largest font size up to maxPx at which text fits maxWidth.
function fitText(ctx, text, weight, maxPx, maxWidth) {
  let px = maxPx;
  ctx.font = font(weight, px);
  const width = ctx.measureText(text).width;
  if (width > maxWidth) px = Math.max(8, (px * maxWidth) / width);
  ctx.font = font(weight, px);
  return px;
}

// The medical-cross emblem in a ring, centred at (x, y) with radius r.
function emblem(ctx, x, y, r, ring, cross) {
  ctx.save();
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cross;
  const arm = r * 0.34;
  const len = r * 1.1;
  ctx.fillRect(x - arm / 2, y - len / 2, arm, len);
  ctx.fillRect(x - len / 2, y - arm / 2, len, arm);
  ctx.restore();
}

// A banner poster of `design` filling a w x h canvas. Wide boards put the emblem left of the text block.
export function drawPoster(ctx, design, w, h) {
  const { palette } = design;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, palette.bg0);
  g.addColorStop(1, palette.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // diagonal light rays
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = palette.ink;
  for (let i = -2; i < 8; i += 2) {
    ctx.beginPath();
    ctx.moveTo((i * w) / 6, 0);
    ctx.lineTo(((i + 1) * w) / 6, 0);
    ctx.lineTo(((i + 0.4) * w) / 6, h);
    ctx.lineTo(((i - 0.6) * w) / 6, h);
    ctx.fill();
  }
  ctx.restore();
  const band = h * 0.13;
  ctx.fillStyle = palette.band;
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(0, h - band - h * 0.018, w, h * 0.018);
  const wide = w / h > 1.8;
  const pad = h * 0.08;
  const r = wide ? h * 0.3 : w * 0.11;
  const ex = wide ? pad + r : w - pad - r;
  const ey = wide ? (h - band) / 2 : pad + r;
  emblem(ctx, ex, ey, r, palette.accent, palette.band);
  const left = wide ? ex + r + pad : pad;
  const textW = w - left - pad;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let y = wide ? h * 0.08 : pad + r * 2 + pad * 0.6;
  ctx.fillStyle = palette.accent;
  const kickerPx = fitText(ctx, design.kicker, 800, h * (wide ? 0.09 : 0.07), textW);
  y += kickerPx;
  ctx.fillText(design.kicker, left, y);
  ctx.fillStyle = palette.ink;
  for (const line of design.lines) {
    const px = fitText(ctx, line, 900, h * (wide ? 0.17 : 0.13), textW);
    y += px * 1.12;
    ctx.fillText(line, left, y);
  }
  ctx.globalAlpha = 0.92;
  const subPx = fitText(ctx, design.sub, 700, h * (wide ? 0.085 : 0.06), textW);
  y += subPx * 1.4;
  ctx.fillText(design.sub, left, y);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  fitText(ctx, design.footer, 800, band * 0.6, w - pad * 2);
  ctx.fillText(design.footer, w / 2, h - band * 0.3);
}

function drawSlide(ctx, slide, w, h, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = slide.tone;
  const kickerPx = fitText(ctx, slide.kicker, 800, h * 0.14, w * 0.6);
  ctx.fillText(slide.kicker, w / 2, h * 0.05 + kickerPx);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = slide.tone;
  ctx.shadowBlur = h * 0.04;
  fitText(ctx, slide.title, 900, h * 0.24, w * 0.9);
  ctx.fillText(slide.title, w / 2, h * 0.5);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#e6eefc";
  fitText(ctx, slide.sub, 700, h * 0.14, w * 0.86);
  ctx.fillText(slide.sub, w / 2, h * 0.74);
  ctx.restore();
}

// One LED frame (see screenFrame) on a w x h canvas: black panel, the slide cross-fading into the next one, a scrolling
// ticker band at the bottom and the dot pitch of the LED modules over everything.
export function drawScreen(ctx, frame, w, h) {
  ctx.fillStyle = "#03060d";
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, h * 0.4, h * 0.05, w / 2, h * 0.4, w * 0.6);
  glow.addColorStop(0, "#102a5e");
  glow.addColorStop(1, "#03060d");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h * 0.8);
  drawSlide(ctx, SCREEN_SLIDES[frame.slide], w, h * 0.8, 1 - frame.mix);
  drawSlide(ctx, SCREEN_SLIDES[frame.next], w, h * 0.8, frame.mix);
  const band = h * 0.2;
  ctx.fillStyle = "#e2382f";
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = font(800, band * 0.58);
  const text = SCREEN_TICKER.text;
  const span = ctx.measureText(text).width;
  for (let x = -frame.ticker * span; x < w; x += span) ctx.fillText(text, x, h - band / 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  const pitch = Math.max(3, Math.round(h / 128));
  for (let x = 0; x < w; x += pitch) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += pitch) ctx.fillRect(0, y, w, 1);
}

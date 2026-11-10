/** @type {import('tailwindcss').Config} */
// 색은 src/ui/tokens.css의 토큰 이름만 연다. Tailwind 기본 팔레트(slate, blue ...)는 쓰지 않는다.
const tokenColor = (name) => `var(--colors-${name})`;

module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    colors: {
      ink: tokenColor("ink"),
      "ink-muted": tokenColor("ink-muted"),
      "ink-subtle": tokenColor("ink-subtle"),
      canvas: tokenColor("canvas"),
      "surface-1": tokenColor("surface-1"),
      "surface-2": tokenColor("surface-2"),
      "surface-3": tokenColor("surface-3"),
      hairline: tokenColor("hairline"),
      "hairline-strong": tokenColor("hairline-strong"),
      primary: tokenColor("primary"),
      "primary-hover": tokenColor("primary-hover"),
      "on-primary": tokenColor("on-primary"),
      success: tokenColor("semantic-success"),
      warning: tokenColor("semantic-warning"),
      danger: tokenColor("semantic-danger"),
      transparent: "transparent",
      current: "currentColor",
    },
    extend: {
      // 테두리 색을 적지 않은 `border`가 currentColor가 되지 않도록 기본값을 hairline으로 둔다.
      borderColor: {
        DEFAULT: tokenColor("hairline"),
      },
      fontFamily: {
        sans: [
          '"Wanted Sans Variable"',
          '"Wanted Sans"',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif'
        ],
      },
      fontSize: {
        display: ["var(--text-display)", { lineHeight: "var(--text-display-leading)", fontWeight: "var(--text-display-weight)", letterSpacing: "var(--tracking-display)" }],
        title: ["var(--text-title)", { lineHeight: "var(--text-title-leading)", fontWeight: "var(--text-title-weight)" }],
        body: ["var(--text-body)", { lineHeight: "var(--text-body-leading)", fontWeight: "var(--text-body-weight)" }],
        caption: ["var(--text-caption)", { lineHeight: "var(--text-caption-leading)", fontWeight: "var(--text-caption-weight)" }],
        micro: ["var(--text-micro)", { lineHeight: "var(--text-micro-leading)", fontWeight: "var(--text-micro-weight)" }],
      },
      borderRadius: {
        control: "var(--rounded-control)",
        card: "var(--rounded-card)",
        pill: "var(--rounded-pill)",
      },
      boxShadow: {
        popover: "var(--shadow-popover)",
        dialog: "var(--shadow-dialog)",
      },
      zIndex: {
        canvas: "var(--layer-canvas)",
        labels: "var(--layer-labels)",
        hud: "var(--layer-hud)",
        rail: "var(--layer-rail)",
        modal: "var(--layer-modal)",
      },
      // 이름 없는 transition 유틸리티도 토큰 시간과 곡선을 쓴다(MOT-17).
      transitionTimingFunction: {
        DEFAULT: "var(--motion-ease-standard)",
      },
      transitionDuration: {
        DEFAULT: "var(--motion-micro)",
        micro: "var(--motion-micro)",
        state: "var(--motion-state)",
        surface: "var(--motion-surface)",
      },
    },
  },
  plugins: [],
};

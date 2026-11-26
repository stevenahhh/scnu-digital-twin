const tailwindcssAnimate = require("tailwindcss-animate");

/** @type {import('tailwindcss').Config} */
// 색은 src/ui/tokens.css의 토큰 이름만 연다. Tailwind 기본 팔레트(slate, blue ...)는 쓰지 않는다.
const tokenColor = (name) => `var(--colors-${name})`;
// shadcn/ui 색. tokens.css가 토큰에서 옮겨 적은 HSL 채널을 읽으므로 bg-primary/90 같은 투명도가 동작한다.
const shadcnColor = (name) => `hsl(var(--${name}) / <alpha-value>)`;
const shadcnPair = (name) => ({ DEFAULT: shadcnColor(name), foreground: shadcnColor(`${name}-foreground`) });

// tailwindcss-animate의 delay, duration, ease는 이름 있는 값만 받게 한다. 임의값까지 받으면
// 기존 ease-[var(--motion-ease-standard)]가 transition 유틸리티와 겹쳐 CSS에서 사라진다.
const TRANSITION_UTILITIES = new Set(["delay", "duration", "ease"]);
const animatePlugin = {
  ...tailwindcssAnimate,
  handler: (api) =>
    tailwindcssAnimate.handler({
      ...api,
      matchUtilities: (utilities, options) =>
        api.matchUtilities(
          utilities,
          Object.keys(utilities).some((name) => TRANSITION_UTILITIES.has(name)) ? { ...options, type: "lookup" } : options,
        ),
    }),
};

module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
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
    // shadow-popover는 그림자 토큰만 뜻한다. popover 색이 그림자 색 유틸리티로도 만들어지지 않게 뺀다.
    boxShadowColor: ({ theme }) => {
      const { popover: _popover, ...colors } = theme("colors");
      return colors;
    },
    extend: {
      // shadcn/ui 색 이름. primary는 기존 bg-primary, text-primary를 그대로 두고 투명도와 foreground를 더한다.
      colors: {
        background: shadcnColor("background"),
        foreground: shadcnColor("foreground"),
        card: shadcnPair("card"),
        popover: shadcnPair("popover"),
        primary: shadcnPair("primary"),
        secondary: shadcnPair("secondary"),
        muted: shadcnPair("muted"),
        accent: shadcnPair("accent"),
        destructive: shadcnPair("destructive"),
        border: shadcnColor("border"),
        input: shadcnColor("input"),
        ring: shadcnColor("ring"),
      },
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
        popover: "var(--rounded-popover)",
        card: "var(--rounded-card)",
        pill: "var(--rounded-pill)",
        // shadcn 모서리 클래스도 같은 단계를 쓴다: md는 control, lg는 popover(p-1 메뉴·목록), xl은 card, sm은 xs.
        xl: "var(--rounded-card)",
        lg: "var(--rounded-lg)",
        md: "var(--rounded-control)",
        sm: "var(--rounded-xs)",
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
  plugins: [animatePlugin],
};

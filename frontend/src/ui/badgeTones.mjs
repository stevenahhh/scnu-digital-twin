// 상태 배지 색 조합의 기준값. 화면의 클래스는 components/ui/badge.jsx의 variant에 같은 값으로 적는다
// (Tailwind가 클래스 이름을 소스에서 그대로 읽어야 해서 여기서 만들어 넘길 수 없다).
// 의미색(성공·경고·위험)은 같은 색조의 wash 바탕 위에 쓴다. 밝은 테마에서 의미색 글자를 wash 위에 그대로 쓰면
// 4.5:1에 못 미치므로, 글자는 의미색을 ink 쪽으로 TONE_TEXT_MIX % 섞어 대비를 올린다(흰 글자는 쓰지 않는다).
export const TONE_TEXT_MIX = 75;

export const BADGE_TONES = {
  neutral: { background: "--colors-surface-2", text: "--colors-ink-muted", border: "--colors-hairline" },
  success: { semantic: "--colors-semantic-success" },
  warning: { semantic: "--colors-semantic-warning" },
  danger: { semantic: "--colors-semantic-danger" },
  // 추정값은 상태색으로 칠하지 않는다. 점선 테두리로 구분하고, 11px 배지 글자는 ink-muted로 밝은 테마에서도 4.5:1을 넘긴다.
  estimate: { background: "--colors-surface-1", text: "--colors-ink-muted", border: "--colors-hairline-strong", dashed: true },
  sample: { semantic: "--colors-semantic-warning" },
};

export const TONE_DEFAULT_LABEL = { estimate: "추정", sample: "샘플 데이터" };

// 상태 배지 색 조합. 바탕과 글자는 모두 tokens.css의 토큰에서 만든다.
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

// 의미색 톤의 글자색(배지 글자, 알림 아이콘에 같이 쓴다).
export function toneInk(tone) {
  const spec = BADGE_TONES[tone] ?? BADGE_TONES.neutral;
  return spec.semantic ? `color-mix(in srgb, var(${spec.semantic}) ${TONE_TEXT_MIX}%, var(--colors-ink))` : `var(${spec.text})`;
}

export function toneBackground(tone) {
  const spec = BADGE_TONES[tone] ?? BADGE_TONES.neutral;
  return spec.semantic ? `var(${spec.semantic}-wash)` : `var(${spec.background})`;
}

export function badgeStyle(tone) {
  const spec = BADGE_TONES[tone] ?? BADGE_TONES.neutral;
  return {
    backgroundColor: toneBackground(tone),
    color: toneInk(tone),
    borderColor: spec.semantic ? `color-mix(in srgb, var(${spec.semantic}) 40%, var(--colors-surface-1))` : `var(${spec.border})`,
    borderStyle: spec.dashed ? "dashed" : "solid",
  };
}

# 공용 UI 기본 요소

Legacy와 VWorld 두 대시보드가 함께 쓰는 기본 요소다. 색, 글자 크기, 모서리, 그림자, 움직임, 겹침 순서는 모두
`tokens.css`의 토큰에서 오고, 규칙은 저장소 루트의 `DESIGN.md` §5를 따른다. 내보내기는 `index.mjs` 하나로 모은다.

## 확인 화면(갤러리)

`?ui=gallery`를 붙여 Legacy 진입점을 열면 대시보드 대신 모든 기본 요소를 상태별로 늘어놓은 화면이 뜬다.
`Gallery.jsx`는 따로 나눠 불러오므로 대시보드 번들에는 들어가지 않는다.

```text
http://127.0.0.1:<port>/?ui=gallery              어두운 테마
http://127.0.0.1:<port>/?ui=gallery&theme=light  밝은 테마
```

각 묶음은 `data-qa="gallery-<이름>"` 구역에 있다. 시각 QA는 이 구역을 1440x900과 390x844에서 찍는다.
올림(hover)과 누름(active) 상태는 `data-gallery-force` 표시가 붙은 요소에 브라우저 개발 도구로 강제로 건다.

## 기본 요소

| 요소 | 파일 | 요점 |
| --- | --- | --- |
| `Button` | `Button.jsx` | primary·secondary·ghost, sm·md(32/40px, 굵은 포인터 44px), 비활성 사유는 `title`, 처리 중에는 안쪽 스피너 하나 |
| `Segmented` | `Segmented.jsx` | 탭(`tablist`) 또는 라디오(`radiogroup`), 화살표 키 이동, 활성 모양 하나(surface-2 + 점) |
| `StatusBadge` | `StatusBadge.jsx` | neutral·success·warning·danger·estimate·sample, wash 바탕 + 대비 4.5:1 글자(`badgeTones.mjs`), 글자가 항상 있다 |
| `Alert` | `Alert.jsx` | 원인·설명·마지막 정상 값·다음 동작, `자세히` 펼침과 복사, danger만 `role="alert"` |
| `SectionHeader` | `SectionHeader.jsx` | 한국어 문장형 제목, 실제 heading 수준, 머리말·자간 없음 |
| `Breadcrumb` | `Breadcrumb.jsx` | `nav[aria-label="breadcrumb"]`, 마지막을 뺀 단계는 버튼 |
| `Disclosure` | `Disclosure.jsx` | `aria-expanded` 요약 버튼, 내용이 아래로 자란다 |
| `Popover` | `Popover.jsx` | 트리거에 붙는 면, Esc·바깥 클릭으로 닫힘, 포커스는 트리거로 |

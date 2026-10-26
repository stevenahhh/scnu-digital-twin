// 3D 장면(three.js)은 CSS 변수를 읽을 수 없어, tokens.css의 강조색에서 나온 값을 여기서 한 번만 적는다.
// DOM의 --colors-primary와 장면의 선택색이 같은 색조를 쓰도록 이 값만 바꾸고 tokens.css와 함께 맞춘다.

// --colors-primary와 같은 값.
export const ACCENT_HEX = "#5e6ad2";
// 선택된 건물·방에 입히는 색. 강조색 그대로다.
export const SELECTION_HEX = ACCENT_HEX;
// 마우스를 올린 건물 쪽으로 옮겨 가는 옅은 색: 강조색 35% + 흰색 65%.
export const HOVER_HEX = "#c7cbef";
// 선택 밖 건물을 흐리게 할 때의 검은 막 투명도(--colors-dim의 알파와 같다).
export const DIM_ALPHA = 0.2;

// 화면에 하나뿐인 브랜드 표시이자 화면의 h1. 내려받은 로고 파일 없이 글꼴로 그린 글자 워드마크다.
// 데스크톱은 HUD에, 폰은 시트 머리에 하나만 그린다(둘이 함께 보이지 않는다).
// 글자는 Body 단계(--text-body: 데스크톱 14px, 폰 17px)를 따른다. 상자는 폰 단계에 맞춰 잡는다.
export function Wordmark({ className }) {
  return (
    <h1 className={className ? `m-0 flex leading-none ${className}` : "m-0 flex leading-none"}>
      <svg role="img" aria-label="순천대학교" data-qa="wordmark" viewBox="0 0 92 22" width="92" height="22">
        <text x="0" y="17" fill="currentColor" fontWeight="600" style={{ fontSize: "var(--text-body)" }} aria-hidden="true">순천대학교</text>
      </svg>
    </h1>
  );
}

// 화면에 하나뿐인 브랜드 표시. 내려받은 로고 파일 없이 글꼴로 그린 글자 워드마크다.
export function Wordmark({ className }) {
  return (
    <svg role="img" aria-label="순천대학교" data-qa="wordmark" viewBox="0 0 88 20" width="88" height="20" className={className}>
      <text x="0" y="15" fill="currentColor" fontSize="16" fontWeight="700" letterSpacing="-0.3" aria-hidden="true">순천대학교</text>
    </svg>
  );
}

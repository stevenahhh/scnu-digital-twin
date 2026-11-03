// 조건부 클래스 이름을 공백 하나로 잇는다. 거짓 값은 버린다.
export function cx(...names) {
  return names.filter(Boolean).join(" ");
}

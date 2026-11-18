import {
  Breadcrumb as BreadcrumbRoot,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// 캠퍼스 › 건물 › 층 › 호실. 마지막(현재 위치)을 뺀 모든 단계가 버튼이다.
// 구분자 `›`는 글자로 그려 경로를 글로 읽어도(복사·검색) 단계가 이어진다. 보조 기술에는 목록 구조로 충분하므로 숨긴다.
// currentHeading(2..4)이면 현재 위치를 그 화면의 제목(h2 등)으로 쓴다. item.ariaLabel은 버튼의 이름을 더 자세히 준다
// (보이는 글자를 포함해야 한다).
export function Breadcrumb({ items, currentHeading = null, className, ...rest }) {
  const Current = currentHeading ? `h${Math.min(Math.max(currentHeading, 2), 4)}` : "span";
  return (
    <BreadcrumbRoot data-qa="breadcrumb" className={className} {...rest}>
      <BreadcrumbList>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <BreadcrumbItem key={item.id ?? item.label}>
              {last ? (
                <BreadcrumbPage asChild>
                  <Current>{item.label}</Current>
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <button type="button" onClick={item.onSelect} aria-label={item.ariaLabel}>
                    {item.label}
                  </button>
                </BreadcrumbLink>
              )}
              {!last && <BreadcrumbSeparator>›</BreadcrumbSeparator>}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </BreadcrumbRoot>
  );
}

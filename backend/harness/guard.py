from __future__ import annotations

FOOTERS = {
    "estimated": "※ 체감온도, UTCI, WBGT, 국지 기온은 추정값입니다.",
    "stale": "※ 실시간이 아닌 저장된 기상 데이터를 기준으로 한 답변입니다.",
    "sample": "※ 샘플 데이터를 사용한 답변입니다.",
    "simulation": "※ 통제 정보는 관리자가 설정한 시뮬레이션 시나리오이며 공식 공지가 아닙니다.",
}
REQUIRED_WORDS = {"estimated": "추정", "stale": "저장된 기상 데이터", "sample": "샘플 데이터", "simulation": "시뮬레이션 시나리오"}


def _header(digest: str) -> str:
    return digest.split("\n", 1)[0]


def flags_for(digests: list[str]) -> dict[str, bool]:
    headers = [_header(d) for d in digests]
    return {
        "estimated": any("추정값" in h for h in headers),
        "stale": any("STALE" in h or " cache" in h for h in headers),
        "sample": any("SAMPLE" in h for h in headers),
        "simulation": any("시뮬레이션 시나리오" in h for h in headers),
    }


def apply_guard(text: str, digests: list[str]) -> tuple[str, dict[str, bool]]:
    flags = flags_for(digests)
    missing = [FOOTERS[name] for name, on in flags.items() if on and REQUIRED_WORDS[name] not in text]
    return (text.rstrip() + "\n\n" + "\n".join(missing) if missing else text), flags

from mcp.server.mcpserver import Context, MCPServer

from .auth import require_admin


def register_prompts(server: MCPServer) -> None:
    @server.prompt(title="지금 캠퍼스 날씨")
    def weather_now() -> str:
        return "지금 캠퍼스 날씨와 미세먼지 상태를 관측 시각과 함께 알려줘."

    @server.prompt(title="지금 시원한 곳")
    def cool_places() -> str:
        return "지금 캠퍼스에서 시원한 곳 5곳을 추정 체감온도로 비교해줘."

    @server.prompt(title="이 건물 상태")
    def this_building() -> str:
        return "현재 선택한 건물의 추정 열환경과 시뮬레이션 시나리오를 알려줘."

    @server.prompt(title="통제·주차 현황")
    def campus_notices() -> str:
        return "현재 통제 시뮬레이션 시나리오와 주차 현황을 알려줘."

    @server.prompt(title="통제 시나리오 초안")
    def admin_draft_restriction(ctx: Context) -> str:
        require_admin(ctx)
        return "통제할 장소와 사유를 확인하고 통제 시뮬레이션 시나리오 초안을 작성해줘. 적용 전에 확인을 받아줘."

    @server.prompt(title="교통 안전 요약")
    def admin_traffic_brief(ctx: Context) -> str:
        require_admin(ctx)
        return "현재 교통 시뮬레이션의 유형별·위험도별 에이전트 수와 근접 사고 및 이벤트 수를 요약해줘."

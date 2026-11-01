# main.py

import json
import sys
from pathlib import Path

_WEATHER_ROOT = str(Path(__file__).parent)
if _WEATHER_ROOT not in sys.path:
    sys.path.insert(0, _WEATHER_ROOT)

from collectors.kma_current import fetch_kma_current
from collectors.air_quality import fetch_air_quality
from collectors.kma_forecast import fetch_kma_forecast
from collectors.upstream import UpstreamError
from domain.environment import build_environment_result
from domain.zones import ZONES


def main():
    weather = fetch_kma_current()
    air_quality = fetch_air_quality()
    weather.update(air_quality)

    environment_result = build_environment_result(weather, ZONES)
    forecast = fetch_kma_forecast()

    final_result = {
        **environment_result,
        "forecast": forecast,
    }

    print(json.dumps(final_result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except UpstreamError as error:
        print(f"기상 데이터를 가져오지 못했습니다: {error.kind}", file=sys.stderr)
        sys.exit(2)

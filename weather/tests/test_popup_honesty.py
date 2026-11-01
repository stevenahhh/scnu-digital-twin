from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from processors.microclimate import WeatherInputMissing, calculate_microclimate_for_element
from processors.popup_formatter import format_popup_response
from processors.thermal_index import generate_reasons


POPUP_BASELINE_KEYS = [
    "element_id",
    "name",
    "zone_id",
    "element_type",
    "timestamp",
    "data_note",
    "thermal",
    "factors",
    "delta",
    "reasons",
    "material",
    "base_weather",
]


def test_missing_temperature_raises_weather_input_missing():
    with pytest.raises(WeatherInputMissing) as exc_info:
        calculate_microclimate_for_element(
            {"humidity": 50, "wind_speed": 1},
            {"element_id": "BLD_D4", "microclimate": {}},
        )

    assert exc_info.value.code == "weather_input_missing"
    assert exc_info.value.field == "temperature"


def test_popup_formatter_preserves_baseline_keys_and_adds_freshness():
    popup = format_popup_response(
        element_id="BLD_D4",
        name="공과대학 3호관",
        zone_id="zone_D",
        element_type="building",
        pipeline_result={},
        microclimate={},
        weather={"temperature": 22, "humidity": 50, "wind_speed": 1},
        timestamp="20261016T1100",
        freshness={"status": "fresh"},
    )

    assert set(popup) == set(POPUP_BASELINE_KEYS) | {"freshness"}
    assert popup["freshness"] == {"status": "fresh"}


@pytest.mark.parametrize(
    "inputs",
    [
        (36, 50, 2, 36, 36, 34),
        (20, 60, 0.2, 45, 30, 29),
        (20, 85, 2, 20, 20, 20),
        (20, 50, 0.5, 20, 20, 20),
        (20, 50, 2, 20, 20, 32),
        (20, 50, 2, 20, 20, 20),
    ],
)
def test_every_emitted_reason_is_marked_as_estimated(inputs):
    reasons = generate_reasons(*inputs)
    assert reasons
    assert all(reason.endswith("(추정)") for reason in reasons)
    assert all(reason.count("(추정)") == 1 for reason in reasons)

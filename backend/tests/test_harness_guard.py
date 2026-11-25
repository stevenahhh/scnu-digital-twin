from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from common.campus_auth import Account
from harness.auth import owner_for
from harness.events import HEARTBEAT, sse
from harness.guard import FOOTERS, apply_guard

ESTIMATE_DIGEST = "comfort_rank metric=utci order=hot n=3 | 추정값 | weather live, KMA obs 13:00 KST, age 4m\nBLD_D4\t공과대학 3호관\t34.9\t높음"
STALE_DIGEST = "campus_weather | weather cache, KMA obs 11:00 KST, age 2h10m, STALE\n기온 6.1"
SAMPLE_DIGEST = "building_status | 추정값 | SAMPLE\nBLD_D4 ..."
SCENARIO_DIGEST = "campus_status | 시뮬레이션 시나리오\nRST_1 RD_057 공사"


def test_guard_adds_the_missing_estimate_footer_and_sets_flags() -> None:
    text, flags = apply_guard("공과대학 3호관이 34.9도로 가장 덥습니다.", [ESTIMATE_DIGEST])
    assert text.endswith(FOOTERS["estimated"])
    assert flags == {"estimated": True, "stale": False, "sample": False, "simulation": False}


def test_guard_keeps_text_that_already_uses_the_required_words() -> None:
    answer = "추정 체감온도는 34.9도입니다. 저장된 기상 데이터(11:00 기준)이며 시뮬레이션 시나리오가 있습니다. 샘플 데이터입니다."
    text, flags = apply_guard(answer, [ESTIMATE_DIGEST, STALE_DIGEST, SAMPLE_DIGEST, SCENARIO_DIGEST])
    assert text == answer
    assert all(flags.values())


def test_guard_appends_each_missing_label_once() -> None:
    text, flags = apply_guard("답변입니다.", [STALE_DIGEST, SAMPLE_DIGEST, SCENARIO_DIGEST, STALE_DIGEST])
    assert text.count(FOOTERS["stale"]) == 1
    assert FOOTERS["sample"] in text and FOOTERS["simulation"] in text
    assert flags["stale"] and flags["sample"] and flags["simulation"]


def test_guard_without_digests_leaves_text_and_flags_clear() -> None:
    assert apply_guard("안녕하세요.", []) == ("안녕하세요.", {"estimated": False, "stale": False, "sample": False, "simulation": False})


def test_owner_key_separates_accounts_and_guest_clients() -> None:
    student = owner_for(Account("20239901", "학생", "student"), None)
    assert student.key == "acct:20239901" and student.role == "student"
    guest_a = owner_for(Account("guest-student", "게스트", "student", guest=True), "a" * 22)
    guest_b = owner_for(Account("guest-student", "게스트", "student", guest=True), "b" * 22)
    assert guest_a.key != guest_b.key and guest_a.key.startswith("guest:student:")
    assert len(student.dir) == 16


@pytest.mark.parametrize("client_id", [None, "short", "x" * 65, "bad id with spaces!!!!"])
def test_guest_without_a_valid_client_id_is_rejected(client_id) -> None:
    with pytest.raises(HTTPException) as caught:
        owner_for(Account("guest-admin", "게스트", "admin", guest=True), client_id)
    assert caught.value.status_code == 400
    assert caught.value.detail["code"] == "client_id_required"


def test_sse_frames_named_events_and_heartbeats() -> None:
    frame = sse("token", {"text": "안녕"})
    assert frame == ("event: token\ndata: " + json.dumps({"text": "안녕"}, ensure_ascii=False) + "\n\n").encode()
    assert HEARTBEAT == b": keep-alive\n\n"

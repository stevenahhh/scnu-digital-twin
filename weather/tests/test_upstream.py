import requests
import pytest

from weather.collectors.upstream import UpstreamError, request_json


SERVICE_KEY = "secret-service-key"


class FakeResponse:
    def __init__(self, status_code=200, text="", data=None):
        self.status_code = status_code
        self.text = text
        self.data = data

    def json(self):
        if isinstance(self.data, Exception):
            raise self.data
        return self.data


class FakeSession:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.call = None

    def get(self, url, *, params, timeout):
        self.call = (url, params, timeout)
        if self.error:
            raise self.error
        return self.response


def call(session):
    return request_json(
        "KMA",
        "https://example.test/data",
        {"serviceKey": SERVICE_KEY},
        connect_timeout=1,
        read_timeout=2,
        session=session,
    )


def json_response(code="00", items=None):
    return {
        "response": {
            "header": {"resultCode": code},
            "body": {"items": [] if items is None else items},
        }
    }


def test_happy_path_and_timeout_tuple():
    session = FakeSession(FakeResponse(data=json_response(items=[{"x": 1}])))
    assert call(session) == json_response(items=[{"x": 1}])
    assert session.call[2] == (1, 2)


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (requests.Timeout(f"timeout {SERVICE_KEY}"), "timeout"),
        (requests.ConnectionError(f"connection {SERVICE_KEY}"), "connection"),
    ],
)
def test_request_errors_are_classified_and_redacted(error, kind):
    with pytest.raises(UpstreamError) as caught:
        call(FakeSession(error=error))
    assert caught.value.kind == kind
    assert SERVICE_KEY not in str(caught.value)


@pytest.mark.parametrize(
    ("status", "kind"),
    [(429, "quota"), (403, "auth"), (500, "http_status")],
)
def test_http_status_classification_and_redaction(status, kind):
    with pytest.raises(UpstreamError) as caught:
        call(FakeSession(FakeResponse(status_code=status, text=SERVICE_KEY)))
    assert caught.value.kind == kind
    assert SERVICE_KEY not in str(caught.value)


@pytest.mark.parametrize(
    ("code", "kind"),
    [("22", "quota"), ("30", "auth"), ("99", "gateway_error")],
)
def test_xml_gateway_classification(code, kind):
    body = (
        "<OpenAPI_ServiceResponse><cmmMsgHeader>"
        f"<returnReasonCode>{code}</returnReasonCode>"
        f"<errMsg>{SERVICE_KEY}</errMsg>"
        "</cmmMsgHeader></OpenAPI_ServiceResponse>"
    )
    with pytest.raises(UpstreamError) as caught:
        call(FakeSession(FakeResponse(text=body)))
    assert caught.value.kind == kind
    assert SERVICE_KEY not in str(caught.value)


@pytest.mark.parametrize(
    ("code", "kind"),
    [
        ("00", None),
        ("03", "no_data"),
        ("22", "quota"),
        ("30", "auth"),
        ("10", "result_code"),
    ],
)
def test_json_result_code_classification(code, kind):
    response = FakeResponse(data=json_response(code))
    if kind is None:
        assert call(FakeSession(response)) == json_response()
    else:
        with pytest.raises(UpstreamError) as caught:
            call(FakeSession(response))
        assert caught.value.kind == kind
        assert SERVICE_KEY not in str(caught.value)


def test_missing_items_is_malformed():
    data = {"response": {"header": {"resultCode": "00"}, "body": {}}}
    with pytest.raises(UpstreamError) as caught:
        call(FakeSession(FakeResponse(data=data)))
    assert caught.value.kind == "malformed"
    assert SERVICE_KEY not in str(caught.value)


def test_non_json_body_is_malformed():
    with pytest.raises(UpstreamError) as caught:
        call(FakeSession(FakeResponse(text=f"not json {SERVICE_KEY}", data=ValueError())))
    assert caught.value.kind == "malformed"
    assert SERVICE_KEY not in str(caught.value)

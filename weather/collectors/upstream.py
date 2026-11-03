"""Shared request and error classification for weather upstream APIs."""

import json
import re
from typing import Any
from xml.etree import ElementTree

import requests


class UpstreamError(Exception):
    def __init__(self, source: str, kind: str, detail: str):
        self.source = source
        self.kind = kind
        self.detail = detail
        super().__init__(f"{source}: {kind}: {detail}")


def _redact(value: Any, service_key: str) -> str:
    text = str(value)
    if service_key:
        text = text.replace(service_key, "[REDACTED]")
    text = re.sub(r"(?i)(serviceKey=)[^&\s\"']+", r"\1[REDACTED]", text)
    return text


def _error(source: str, kind: str, detail: str, service_key: str) -> UpstreamError:
    return UpstreamError(source, kind, _redact(detail, service_key))


def request_json(
    source: str,
    url: str,
    params: dict,
    *,
    connect_timeout: float,
    read_timeout: float,
    session=None,
) -> dict:
    """Request and validate a JSON response with bounded connect/read timeouts."""
    client = session if session is not None else requests
    service_key = str(params.get("serviceKey", ""))
    try:
        response = client.get(
            url,
            params=params,
            timeout=(connect_timeout, read_timeout),
        )
    except requests.Timeout as exc:
        raise _error(source, "timeout", str(exc), service_key) from None
    except requests.ConnectionError as exc:
        raise _error(source, "connection", str(exc), service_key) from None

    if response.status_code == 429:
        raise _error(source, "quota", "HTTP 429", service_key)
    if response.status_code in (401, 403):
        raise _error(source, "auth", f"HTTP {response.status_code}", service_key)
    if response.status_code >= 400:
        raise _error(source, "http_status", f"HTTP {response.status_code}", service_key)

    body = response.text
    if body.lstrip().startswith("<"):
        try:
            root = ElementTree.fromstring(body)
            code = root.findtext(".//returnReasonCode", default="")
        except ElementTree.ParseError:
            raise _error(source, "malformed", "Invalid XML response", service_key) from None
        if code == "22":
            kind = "quota"
        elif code in {"20", "21", "30", "31", "32"}:
            kind = "auth"
        else:
            kind = "gateway_error"
        raise _error(source, kind, f"XML returnReasonCode {code or 'unknown'}", service_key)

    try:
        data = response.json()
    except (ValueError, json.JSONDecodeError):
        raise _error(source, "malformed", "Invalid JSON response", service_key) from None

    try:
        response_data = data["response"]
        header = response_data["header"]
        code = str(header["resultCode"])
    except (KeyError, TypeError):
        raise _error(source, "malformed", "Missing response.header.resultCode", service_key) from None

    if code == "00":
        try:
            response_data["body"]["items"]  # presence check; callers read the items
        except (KeyError, TypeError):
            raise _error(source, "malformed", "Missing response.body.items", service_key) from None
        return data
    if code == "03":
        kind = "no_data"
    elif code == "22":
        kind = "quota"
    elif code in {"20", "21", "30", "31", "32"}:
        kind = "auth"
    else:
        kind = "result_code"
    raise _error(source, kind, f"resultCode {code}", service_key)

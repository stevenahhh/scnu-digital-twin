import assert from "node:assert/strict";
import test from "node:test";
import { toKoreanEnergyError } from "./energyErrorMessages.mjs";

test("uses the API's Korean detail message", () => {
  assert.equal(toKoreanEnergyError({ detail: { message_ko: "요청 오류" } }), "요청 오류");
});

test("maps network, contract, and unknown errors without exposing raw text", () => {
  assert.equal(toKoreanEnergyError(new TypeError("Failed to fetch")), "에너지 API에 연결할 수 없습니다");
  assert.equal(toKoreanEnergyError(Object.assign(new Error("INVALID_PLAN"), { code: "INVALID_PLAN" })), "서버 응답 형식이 올바르지 않습니다");
  assert.equal(toKoreanEnergyError(Object.assign(new TypeError("plan identity mismatch"), { field: "plan" })), "서버 응답 형식이 올바르지 않습니다");
  assert.equal(toKoreanEnergyError(new Error("arrays: required")), "서버 응답 형식이 올바르지 않습니다");
  assert.equal(toKoreanEnergyError(new Error("API offline")), "요청을 처리하지 못했습니다");
});

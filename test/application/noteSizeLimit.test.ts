import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  DEFAULT_MAX_NOTE_SIZE_KB,
  isWithinNoteSizeLimit,
  noteSizeLimitBytes,
} from "../../src/application/noteSizeLimit";

const DEFAULT_BYTES = DEFAULT_MAX_NOTE_SIZE_KB * 1024;

test("an ordinary note is indexed", () => {
  assert.equal(isWithinNoteSizeLimit(64 * 1024, noteSizeLimitBytes(undefined)), true);
});

test("a note past the ceiling is not", () => {
  assert.equal(isWithinNoteSizeLimit(DEFAULT_BYTES + 1, noteSizeLimitBytes(undefined)), false);
});

test("a note exactly at the ceiling is still indexed", () => {
  assert.equal(isWithinNoteSizeLimit(DEFAULT_BYTES, noteSizeLimitBytes(undefined)), true);
});

test("the ceiling can be raised or lowered", () => {
  assert.equal(isWithinNoteSizeLimit(200 * 1024, noteSizeLimitBytes(100)), false);
  assert.equal(isWithinNoteSizeLimit(200 * 1024, noteSizeLimitBytes(300)), true);
});

test("zero and below mean no ceiling at all", () => {
  for (const configured of [0, -1]) {
    assert.equal(noteSizeLimitBytes(configured), undefined, `configured=${configured}`);
    assert.equal(
      isWithinNoteSizeLimit(Number.MAX_SAFE_INTEGER, noteSizeLimitBytes(configured)),
      true,
    );
  }
});

/*
 * A setting is attacker-controlled in an untrusted workspace, and this one is a protection.
 * A value that is not a usable number falls back to the default rather than being read as
 * "no limit", so a malformed setting cannot quietly switch the ceiling off.
 */
test("an unusable setting falls back to the default rather than removing the ceiling", () => {
  for (const configured of [undefined, null, "lots", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.equal(
      noteSizeLimitBytes(configured),
      DEFAULT_BYTES,
      `configured=${String(JSON.stringify(configured) ?? configured)}`,
    );
  }
});

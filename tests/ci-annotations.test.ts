import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationsFor,
  escapeAnnotation,
  parseTapFailures,
  summaryLine,
} from "../scripts/ci-test-annotations";

const TAP = `TAP version 13
# Subtest: a passing test
ok 1 - a passing test
  ---
  duration_ms: 1.1
  ...
# Subtest: a failing test
not ok 2 - a failing test
  ---
  duration_ms: 3.2
  type: 'test'
  failureType: 'testCodeFailure'
  error: 'Expected values to be strictly equal:'
  code: 'ERR_ASSERTION'
  ...
not ok 3 - a skipped test # SKIP git is not available
  ---
  duration_ms: 0
  ...
1..3
# tests 3
# pass 1
# fail 1
# skipped 1
`;

test("TAP failures are parsed into annotations with their error message", () => {
  const failures = parseTapFailures(TAP);
  assert.equal(
    failures.length,
    1,
    "skipped tests are not reported as failures",
  );
  assert.equal(failures[0].name, "a failing test");
  assert.match(failures[0].detail, /Expected values to be strictly equal/);

  const annotations = annotationsFor(TAP);
  assert.equal(annotations.length, 2);
  assert.match(annotations[0], /^::error title=a failing test::/);
  assert.match(
    annotations[1],
    /^::notice title=Test summary::tests=3 pass=1 fail=1/,
  );
});

test("a clean report produces only a summary notice", () => {
  const clean = `ok 1 - fine\n1..1\n# tests 1\n# pass 1\n# fail 0\n`;
  assert.deepEqual(parseTapFailures(clean), []);
  assert.deepEqual(annotationsFor(clean), [
    "::notice title=Test summary::tests=1 pass=1 fail=0",
  ]);
  assert.equal(summaryLine(clean), "tests=1 pass=1 fail=0");
});

test("annotation escaping never breaks the workflow command", () => {
  const escaped = escapeAnnotation("100% done\nline2\r\nline3");
  assert.equal(escaped.includes("\n"), false);
  assert.equal(escaped.includes("\r"), false);
  assert.match(escaped, /100%25 done/);
});

test("nested subtest failures report the innermost error, not 'test failed'", () => {
  const nested = `not ok 4 - database stores sessions
  ---
  duration_ms: 12
  type: 'test'
  failureType: 'subtestFailed'
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
    ---
    error: 'Could not locate the bindings file'
    code: 'MODULE_NOT_FOUND'
    stack: 'Error: Could not locate the bindings file'
    ...
  ...
1..4
# tests 4
# pass 0
# fail 1
`;
  const failures = parseTapFailures(nested);
  assert.equal(failures.length, 1);
  assert.match(failures[0].detail, /Could not locate the bindings file/);
  const annotations = annotationsFor(nested);
  assert.match(annotations[0], /title=database stores sessions/);
  assert.match(annotations[0], /MODULE_NOT_FOUND/);
});

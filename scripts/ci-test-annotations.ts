/**
 * Turn a TAP test report into GitHub Actions annotations.
 *
 * CI logs are hard to read (and slow to fetch); annotations show up directly on
 * the pull request's Checks tab with the failing test name and its error.
 *
 * Usage (CI):
 *   npx tsx .. --test-reporter=tap tests/*.test.ts 2>&1 | tee /tmp/g1code-test.log
 *   npx tsx scripts/ci-test-annotations.ts /tmp/g1code-test.log
 *
 * The script is deliberately dependency-free and never fails the build by
 * itself: it only reports what the TAP output already contains.
 */
import { readFileSync } from "node:fs";

/** GitHub workflow commands need %, CR and LF escaped in the message body. */
export function escapeAnnotation(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .slice(0, 4_000);
}

export type FailedTest = { name: string; detail: string };

/**
 * Parse TAP output (Node's `--test-reporter=tap`) into failing tests.
 *
 * Node emits:
 *   not ok 12 - test name
 *     ---
 *     error: 'the assertion message'
 *     ...
 *     ...
 */
export function parseTapFailures(report: string): FailedTest[] {
  const lines = report.split("\n");
  const failures: FailedTest[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    // Nested subtests are indented, so leading whitespace is allowed here.
    const match = /^\s*not ok \d+ - (.*)$/.exec(lines[index]);
    if (!match) continue;
    if (/#\s*(SKIP|TODO)/i.test(match[1])) continue;
    const name = match[1].replace(/\s*#\s*(SKIP|TODO).*$/i, "").trim();

    // Collect the diagnostic keys of this failure *and* of any nested subtest
    // block that follows it, so the annotation carries the real error instead
    // of a generic "test failed".
    const details = new Map<string, string[]>();
    for (
      let look = index + 1;
      look < Math.min(index + 120, lines.length);
      look += 1
    ) {
      const line = lines[look];
      const next = /^\s*not ok \d+ - /.exec(line);
      if (
        next &&
        (line.match(/^\s*/)?.[0].length ?? 0) <=
          (lines[index].match(/^\s*/)?.[0].length ?? 0)
      )
        break;
      const key =
        /^\s*(error|code|stack|actual|expected|operator|failureType|message):\s*(.*)$/.exec(
          line,
        );
      if (!key || !key[2].trim()) continue;
      const values = details.get(key[1]) ?? [];
      values.push(key[2].trim().slice(0, 600));
      details.set(key[1], values);
    }
    // Nested subtest failures repeat these keys, so pick the most specific
    // value (the innermost error) rather than the generic outer "test failed".
    const specific = (values: string[] | undefined) =>
      values?.find(
        (value) =>
          !/^'?(test failed|subtestFailed|ERR_TEST_FAILURE)'?$/.test(value),
      ) ??
      values?.[0] ??
      "";
    const detail = ["error", "code", "actual", "expected", "operator", "stack"]
      .filter((key) => details.has(key))
      .map((key) => `${key}: ${specific(details.get(key))}`)
      .join(" | ");
    failures.push({ name, detail });
  }
  return failures;
}

export function summaryLine(report: string): string {
  const counts = new Map<string, string>();
  for (const line of report.split("\n")) {
    const match = /^# (tests|pass|fail|skipped|cancelled) (\d+)$/.exec(
      line.trim(),
    );
    if (match) counts.set(match[1], match[2]);
  }
  if (counts.size === 0) return "";
  return ["tests", "pass", "fail", "skipped", "cancelled"]
    .filter((key) => counts.has(key))
    .map((key) => `${key}=${counts.get(key)}`)
    .join(" ");
}

/**
 * The last part of the raw log, as one annotation. TAP nesting can hide the
 * real cause of a file-level failure (module load errors, native bindings), and
 * CI logs are not always reachable — this guarantees the cause is visible.
 */
export function rawTailAnnotation(report: string, maxChars = 3_500): string[] {
  const lines = report.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const interesting = lines.filter(
    (line) =>
      !/^\s*(# (Subtest|tests|pass|fail|skipped|cancelled)|ok \d+ - |---|\.\.\.)/.test(
        line,
      ),
  );
  const source = interesting.length > 0 ? interesting : lines;
  const tail = source.slice(-40).join("\n").slice(-maxChars);
  return [`::error title=Failure detail (log tail)::${escapeAnnotation(tail)}`];
}

export function annotationsFor(report: string): string[] {
  const failures = parseTapFailures(report);
  const lines = [
    ...failures
      .slice(0, 20)
      .map(
        (failure) =>
          `::error title=${escapeAnnotation(failure.name)}::${escapeAnnotation(failure.detail || "test failed")}`,
      ),
  ];
  const summary = summaryLine(report);
  if (summary)
    lines.push(`::notice title=Test summary::${escapeAnnotation(summary)}`);
  return lines;
}

function main(): void {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: ci-test-annotations.ts <tap-report-file>");
    process.exitCode = 0;
    return;
  }
  let report = "";
  try {
    report = readFileSync(target, "utf8");
  } catch (error) {
    console.log(
      `::warning title=Test report unavailable::${escapeAnnotation(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
    return;
  }
  const annotations = [...annotationsFor(report), ...rawTailAnnotation(report)];
  if (annotations.length === 0) {
    console.log("::notice title=Tests::the test report contains no failures");
    return;
  }
  for (const line of annotations) console.log(line);
}

if (process.argv[1] && /ci-test-annotations/.test(process.argv[1])) main();

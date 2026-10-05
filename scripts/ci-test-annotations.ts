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
    const match = /^not ok \d+ - (.*)$/.exec(lines[index]);
    if (!match) continue;
    const name = match[1].replace(/\s*#\s*(SKIP|TODO).*$/i, "").trim();
    if (/#\s*(SKIP|TODO)/i.test(match[1])) continue;
    let detail = "";
    for (
      let look = index + 1;
      look < Math.min(index + 40, lines.length);
      look += 1
    ) {
      const line = lines[look];
      if (/^not ok \d+ - /.test(line) || /^ok \d+ - /.test(line)) break;
      const error = /^\s*(?:error|message):\s*(.*)$/.exec(line);
      if (error && error[1].trim()) {
        detail = error[1].trim();
        break;
      }
    }
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
  const annotations = annotationsFor(report);
  if (annotations.length === 0) {
    console.log("::notice title=Tests::the test report contains no failures");
    return;
  }
  for (const line of annotations) console.log(line);
}

if (process.argv[1] && /ci-test-annotations/.test(process.argv[1])) main();

import path from "node:path";

/**
 * Phase 4 repository intelligence: import/export extraction.
 *
 * This is deliberately regex-based rather than AST-based. A full parser per
 * language would mean a large dependency tree (TypeScript compiler, tree-sitter
 * bindings, …) which the project explicitly wants to avoid. The extractor only
 * needs to answer "which files does this file depend on", which is tolerant of
 * a few missed exotic syntax forms — and it is bounded, synchronous, and
 * covered by tests.
 */

export type ImportKind = "import" | "require" | "from" | "include";

export type FileImport = {
  /** Raw module specifier as written in the source. */
  module: string;
  kind: ImportKind;
  line: number;
  /** Names imported, when the syntax makes them cheap to recover. */
  names?: string[];
};

export type FileExport = {
  name: string;
  kind: "function" | "class" | "const" | "type" | "default" | "unknown";
  line: number;
};

const LINE_OF = (content: string, index: number) =>
  content.slice(0, index).split(/\r?\n/).length;

function extractJavaScript(content: string): FileImport[] {
  const imports: FileImport[] = [];
  const esm =
    /\bimport\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;
  for (const match of content.matchAll(esm)) {
    const clause = (match[1] ?? "").trim();
    const names = clause
      .replace(/[{}*]/g, "")
      .split(",")
      .map((entry) =>
        entry
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim(),
      )
      .filter((entry): entry is string => Boolean(entry));
    imports.push({
      module: match[2],
      kind: "import",
      line: LINE_OF(content, match.index ?? 0),
      names: names.length ? names.slice(0, 32) : undefined,
    });
  }
  const requires = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of content.matchAll(requires)) {
    imports.push({
      module: match[1],
      kind: "require",
      line: LINE_OF(content, match.index ?? 0),
    });
  }
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of content.matchAll(dynamic)) {
    imports.push({
      module: match[1],
      kind: "import",
      line: LINE_OF(content, match.index ?? 0),
    });
  }
  const exports = /\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g;
  for (const match of content.matchAll(exports)) {
    imports.push({
      module: match[1],
      kind: "from",
      line: LINE_OF(content, match.index ?? 0),
    });
  }
  return imports;
}

function extractPython(content: string): FileImport[] {
  const imports: FileImport[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const simple = /^\s*import\s+(.+)$/.exec(line);
    if (simple) {
      for (const part of simple[1].split(",")) {
        const module = part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (module) imports.push({ module, kind: "import", line: index + 1 });
      }
      return;
    }
    const from = /^\s*from\s+([.\w]+)\s+import\s+(.+)$/.exec(line);
    if (from) {
      const names = from[2]
        .replace(/[()]/g, "")
        .split(",")
        .map((entry) =>
          entry
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim(),
        )
        .filter(Boolean);
      imports.push({
        module: from[1],
        kind: "from",
        line: index + 1,
        names: names.slice(0, 32),
      });
    }
  });
  return imports;
}

function extractGo(content: string): FileImport[] {
  const imports: FileImport[] = [];
  const block = /import\s*\(([\s\S]*?)\)/g;
  for (const match of content.matchAll(block)) {
    const startLine = LINE_OF(content, match.index ?? 0);
    match[1].split(/\r?\n/).forEach((line, offset) => {
      const value = /"([^"]+)"/.exec(line);
      if (value)
        imports.push({
          module: value[1],
          kind: "import",
          line: startLine + offset,
        });
    });
  }
  const single = /\bimport\s+(?:\w+\s+)?"([^"]+)"/g;
  for (const match of content.matchAll(single)) {
    imports.push({
      module: match[1],
      kind: "import",
      line: LINE_OF(content, match.index ?? 0),
    });
  }
  return imports;
}

function extractRust(content: string): FileImport[] {
  const imports: FileImport[] = [];
  const useRe = /\buse\s+([\w:{}*,\s]+);/g;
  for (const match of content.matchAll(useRe)) {
    imports.push({
      module: match[1].replace(/\s+/g, ""),
      kind: "import",
      line: LINE_OF(content, match.index ?? 0),
    });
  }
  return imports;
}

function extractJavaLike(content: string): FileImport[] {
  const imports: FileImport[] = [];
  const re = /^\s*import\s+(?:static\s+)?([\w.$*]+)\s*;/gm;
  for (const match of content.matchAll(re)) {
    imports.push({
      module: match[1],
      kind: "import",
      line: LINE_OF(content, match.index ?? 0),
    });
  }
  return imports;
}

export function extractImports(
  content: string,
  filePath: string,
): FileImport[] {
  const extension = path.extname(filePath).toLowerCase();
  const imports =
    extension === ".py"
      ? extractPython(content)
      : extension === ".go"
        ? extractGo(content)
        : extension === ".rs"
          ? extractRust(content)
          : extension === ".java" ||
              extension === ".kt" ||
              extension === ".scala"
            ? extractJavaLike(content)
            : extractJavaScript(content);
  return dedupeImports(imports);
}

function dedupeImports(imports: FileImport[]): FileImport[] {
  const seen = new Set<string>();
  const result: FileImport[] = [];
  for (const entry of imports) {
    const key = `${entry.kind}:${entry.module}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.sort((a, b) => a.line - b.line);
}

export function extractExports(
  content: string,
  filePath: string,
): FileExport[] {
  const exports: FileExport[] = [];
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".py" || extension === ".go" || extension === ".rs") {
    return exports;
  }
  const patterns: Array<[RegExp, FileExport["kind"]]> = [
    [/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, "function"],
    [/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g, "class"],
    [/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, "const"],
    [/\bexport\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/g, "type"],
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of content.matchAll(pattern)) {
      exports.push({
        name: match[1],
        kind,
        line: LINE_OF(content, match.index ?? 0),
      });
    }
  }
  const defaults =
    /\bexport\s+default\s+(?:class|function)?\s*([A-Za-z_$][\w$]*)?/g;
  for (const match of content.matchAll(defaults)) {
    exports.push({
      name: match[1] || "default",
      kind: "default",
      line: LINE_OF(content, match.index ?? 0),
    });
  }
  const seen = new Set<string>();
  return exports
    .filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    })
    .sort((a, b) => a.line - b.line);
}

/**
 * Resolve a module specifier to a workspace-relative file path when the target
 * is a local file. Bare specifiers (npm packages, stdlib) return null so the
 * dependency graph only contains repository files.
 */
export function resolveImportPath(
  fromFile: string,
  specifier: string,
  knownFiles: ReadonlySet<string>,
): string | null {
  if (!specifier) return null;
  const isRelative =
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith(".");
  const isAlias = specifier.startsWith("@/") || specifier.startsWith("~/");
  if (!isRelative && !isAlias && !specifier.endsWith(".py")) return null;

  const fromDir = path.posix.dirname(fromFile.replaceAll("\\", "/"));
  const base = isAlias
    ? specifier.replace(/^[@~]\//, "")
    : path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.py`,
    `${base}.go`,
    `${base}.rs`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
    path.posix.join(base, "index.js"),
    path.posix.join(base, "__init__.py"),
  ];
  for (const candidate of candidates) {
    const normalized = candidate.replace(/^\.\//, "");
    if (knownFiles.has(normalized)) return normalized;
  }
  return null;
}

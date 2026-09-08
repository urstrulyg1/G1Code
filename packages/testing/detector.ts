import { promises as fs } from "node:fs";
import path from "node:path";

export type ProjectType = "npm" | "maven" | "gradle" | "go" | "cargo" | "python" | "make";
export type Project = { type: ProjectType; root: string; testCommand: string; executable: string; testArgs: string[]; testScript?: string };

export async function detectProject(root: string): Promise<Project | null> {
  const exists = async (name: string) => fs.stat(path.join(root, name)).then(() => true).catch(() => false);
  const packageFile = await fs.readFile(path.join(root, "package.json"), "utf8").catch(() => null);
  if (packageFile) {
    try {
      const packageJson = JSON.parse(packageFile) as { scripts?: Record<string, string> };
      const script = ["test", "test:unit", "test:integration"].find((name) => packageJson.scripts?.[name]);
      if (script) return { type: "npm", root, testCommand: `npm run ${script}`, executable: process.platform === "win32" ? "npm.cmd" : "npm", testArgs: ["run", script], testScript: script };
    } catch {
      // Continue looking for another project marker.
    }
  }
  if (await exists("pom.xml")) return { type: "maven", root, testCommand: "mvn test", executable: "mvn", testArgs: ["test"] };
  if (await exists("build.gradle") || await exists("build.gradle.kts")) return { type: "gradle", root, testCommand: "./gradlew test", executable: "./gradlew", testArgs: ["test"] };
  if (await exists("go.mod")) return { type: "go", root, testCommand: "go test ./...", executable: "go", testArgs: ["test", "./..."] };
  if (await exists("Cargo.toml")) return { type: "cargo", root, testCommand: "cargo test", executable: "cargo", testArgs: ["test"] };
  if (await exists("pyproject.toml") || await exists("pytest.ini") || await exists("setup.cfg")) return { type: "python", root, testCommand: "python -m pytest", executable: process.platform === "win32" ? "python.exe" : "python", testArgs: ["-m", "pytest"] };
  if (await exists("Makefile")) return { type: "make", root, testCommand: "make test", executable: "make", testArgs: ["test"] };
  return null;
}

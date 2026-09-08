import path from "node:path";
import { Project } from "./detector";
import { TestCandidate } from "./discovery";

export function targetedCommand(project: Project, candidates: TestCandidate[]): string {
  const first = candidates[0]?.path;
  if (!first) return project.testCommand;
  if (project.type === "npm") return `${project.testCommand} -- ${first}`;
  if (project.type === "maven") return `mvn test -Dtest=${path.basename(first).replace(/\.[^.]+$/, "")}`;
  if (project.type === "go") return `go test ./${path.dirname(first) || "."}`;
  if (project.type === "cargo") return `cargo test ${path.basename(first, path.extname(first))}`;
  if (project.type === "python") return `${project.testCommand} ${first}`;
  return project.testCommand;
}
export function targetedExecutable(project: Project, candidates: TestCandidate[]) {
  const args = [...project.testArgs];
  const first = candidates[0]?.path;
  if (!first) return { executable: project.executable, args };
  if (project.type === "npm") args.push("--", first);
  else if (project.type === "maven") args.splice(1, 0, `-Dtest=${path.basename(first).replace(/\.[^.]+$/, "")}`);
  else if (project.type === "python") args.push(first);
  return { executable: project.executable, args };
}

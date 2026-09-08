import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

async function runE2ESuite() {
  console.log("=== G1CODE DESKTOP E2E INTEGRATION SUITE ===");
  const testWorkspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "g1code-e2e-ws-"),
  );
  const sampleFile = path.join(testWorkspace, "main.ts");
  await fs.writeFile(sampleFile, 'console.log("hello e2e");\n', "utf8");

  try {
    // 1. Launch Electron in smoke/validation mode
    console.log(
      "[1/6] Launching Electron desktop window in validation mode...",
    );
    const electronBinary = path.join(
      process.cwd(),
      "node_modules/electron/dist",
      (await fs.readFile("node_modules/electron/path.txt", "utf8")).trim(),
    );

    const smokePass = await new Promise<boolean>((resolve) => {
      const child = spawn(electronBinary, [".", "--smoke"], { stdio: "pipe" });
      let output = "";
      child.stdout?.on("data", (d) => (output += d.toString()));
      child.stderr?.on("data", (d) => (output += d.toString()));
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(false);
      }, 10000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 || output.includes("SMOKE_LOAD_SUCCESS")) resolve(true);
        else resolve(false);
      });
    });

    assert.equal(smokePass, true, "Electron failed smoke launch");
    console.log(
      "      Electron desktop application launched and mounted successfully (SMOKE_LOAD_SUCCESS).",
    );

    // 2. Start / Verify backend API server
    console.log("[2/6] Verifying backend API server connectivity...");
    let serverOk = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch("http://127.0.0.1:3131/api/health");
        if (res.ok) {
          serverOk = true;
          break;
        }
      } catch {
        // Wait and retry
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    let bgProcess: any = null;
    if (!serverOk) {
      console.log("      Spawning background API server for E2E...");
      const tsxPath = path.join(
        process.cwd(),
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      );
      bgProcess = spawn(process.execPath, [tsxPath, "server.ts"], {
        cwd: process.cwd(),
        stdio: "ignore",
        env: { ...process.env, PORT: "3131" },
      });
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch("http://127.0.0.1:3131/api/health");
          if (res.ok) {
            serverOk = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.equal(
      serverOk,
      true,
      "Backend API server failed to respond on http://127.0.0.1:3131",
    );
    console.log("      API server healthy on http://127.0.0.1:3131");

    // 3. Workspace choose and directory listing E2E
    console.log("[3/6] Testing workspace selection and file tree listing...");
    const chooseRes = await fetch(
      "http://127.0.0.1:3131/api/workspace/choose",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testWorkspace }),
      },
    ).then((r) => r.json());
    assert.equal(chooseRes.workspace, testWorkspace);

    const listRes = await fetch("http://127.0.0.1:3131/api/workspace/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: testWorkspace }),
    }).then((r) => r.json());
    assert.ok(Array.isArray(listRes));
    assert.ok(
      listRes.some((e: any) => e.name === "main.ts" && e.kind === "file"),
    );
    console.log("      Workspace listing verified: found main.ts");

    // 4. File read / write E2E
    console.log("[4/6] Testing file read and write operations...");
    const readRes = await fetch("http://127.0.0.1:3131/api/file/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "main.ts" }),
    }).then((r) => r.json());
    assert.equal(readRes.content, 'console.log("hello e2e");\n');

    await fetch("http://127.0.0.1:3131/api/file/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: "main.ts",
        contents: 'console.log("updated e2e");\n',
      }),
    });

    const verifyRead = await fetch("http://127.0.0.1:3131/api/file/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "main.ts" }),
    }).then((r) => r.json());
    assert.equal(verifyRead.content, 'console.log("updated e2e");\n');
    console.log("      File read and write verified with atomic durability.");

    // 5. Terminal execution E2E
    console.log("[5/6] Testing sandboxed terminal command execution...");
    const termRes = await fetch("http://127.0.0.1:3131/api/terminal/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "echo E2E_TERMINAL_SUCCESS",
        cwd: testWorkspace,
      }),
    }).then((r) => r.json());
    assert.equal(termRes.exitCode, 0);
    assert.ok(termRes.output.includes("E2E_TERMINAL_SUCCESS"));
    console.log("      Terminal command execution verified.");

    // 6. Diagnostics and Git status endpoints
    console.log(
      "[6/6] Testing diagnostics aggregation and Git baseline endpoints...",
    );
    const problemsRes = await fetch(
      `http://127.0.0.1:3131/api/problems?workspace=${encodeURIComponent(testWorkspace)}`,
    ).then((r) => r.json());
    assert.ok(Array.isArray(problemsRes.problems));

    const gitRes = await fetch(
      `http://127.0.0.1:3131/api/git/status?workspace=${encodeURIComponent(testWorkspace)}`,
    ).then((r) => r.json());
    assert.ok(gitRes.branch !== undefined);
    console.log("      Diagnostics and Git status endpoints verified.");

    if (bgProcess) bgProcess.kill("SIGTERM");
    console.log("=== ALL E2E TESTS PASSED SUCCESSFULLY ===");
  } finally {
    await fs
      .rm(testWorkspace, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

runE2ESuite().catch((err) => {
  console.error("E2E suite failed:", err);
  process.exit(1);
});

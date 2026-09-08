import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { DatabaseStore } from "../packages/database/repositories";
import { ChatStorage } from "../packages/database/chat-storage";

test("Chat Storage: getG1CodeDirectories resolves root folder with folder named G1Code", () => {
  const fakeWorkspace = path.join(os.tmpdir(), `test-ws-${Date.now()}`);
  const dirs = ChatStorage.getG1CodeDirectories(fakeWorkspace);
  
  assert.ok(dirs.length >= 1, "Should return candidate directories");
  assert.ok(
    dirs.some((d) => d === path.join(fakeWorkspace, "G1Code")),
    "Workspace root should contain a folder named G1Code",
  );
  assert.ok(
    dirs.some((d) => d.endsWith("G1Code")),
    "Every candidate directory should end with folder named G1Code",
  );
});

test("Chat Storage: persistChat creates JSON, Markdown transcript, and index in G1Code/chats", () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "g1code-chat-test-"));
  try {
    const session = {
      id: "test-session-123",
      workspaceId: tempWorkspace,
      title: "Add authentication middleware",
      mode: "agent",
      model: "google/gemini-2.5-flash",
      provider: "experiential-labs",
      status: "COMPLETED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const messages = [
      {
        role: "user",
        content: "Please add JWT authentication middleware to the Express app.",
        createdAt: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: "I have inspected the project and created `auth.ts` with JWT verification.",
        createdAt: new Date().toISOString(),
      },
    ];

    ChatStorage.persistChat(session, messages, "Successfully added JWT authentication middleware");

    const chatsDir = path.join(tempWorkspace, "G1Code", "chats");
    assert.ok(fs.existsSync(chatsDir), "G1Code/chats folder should exist in workspace root");

    // 1. Verify JSON file
    const jsonPath = path.join(chatsDir, "test-session-123.json");
    assert.ok(fs.existsSync(jsonPath), "Session JSON file should exist");
    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.equal(jsonContent.id, "test-session-123");
    assert.equal(jsonContent.title, "Add authentication middleware");
    assert.equal(jsonContent.messages.length, 2);
    assert.equal(jsonContent.messages[0].role, "user");
    assert.equal(jsonContent.messages[1].role, "assistant");
    assert.equal(jsonContent.summary, "Successfully added JWT authentication middleware");

    // 2. Verify Markdown file
    const mdPath = path.join(chatsDir, "test-session-123.md");
    assert.ok(fs.existsSync(mdPath), "Session Markdown file should exist");
    const mdContent = fs.readFileSync(mdPath, "utf8");
    assert.ok(mdContent.includes("# G1Code Chat: Add authentication middleware"));
    assert.ok(mdContent.includes("Session ID"));
    assert.ok(mdContent.includes("Please add JWT authentication middleware"));
    assert.ok(mdContent.includes("I have inspected the project"));

    // 3. Verify index.json
    const indexPath = path.join(chatsDir, "index.json");
    assert.ok(fs.existsSync(indexPath), "index.json file should exist");
    const indexContent = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.ok(Array.isArray(indexContent));
    assert.equal(indexContent[0].id, "test-session-123");
    assert.equal(indexContent[0].messageCount, 2);
    assert.equal(indexContent[0].jsonFile, "test-session-123.json");
    assert.equal(indexContent[0].markdownFile, "test-session-123.md");
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test("DatabaseStore automatically persists chats to G1Code/chats on session create and addMessage", () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "g1code-db-chat-test-"));
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE task_summaries (session_id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);

  try {
    const store = new DatabaseStore(db);
    const sessionId = "db-session-456";

    // 1. Create session
    store.createSession({
      id: sessionId,
      workspaceId: tempWorkspace,
      title: "Fix responsive layout in CSS",
      mode: "agent",
      model: "claude-3-7-sonnet",
      provider: "experiential-labs",
      status: "RUNNING",
    });

    const chatsDir = path.join(tempWorkspace, "G1Code", "chats");
    assert.ok(fs.existsSync(chatsDir), "G1Code/chats should be created on session creation");
    assert.ok(fs.existsSync(path.join(chatsDir, `${sessionId}.json`)));

    // 2. Add User Message
    store.addMessage(sessionId, "user", "Fix the responsive drawer layout on mobile");

    let json = JSON.parse(fs.readFileSync(path.join(chatsDir, `${sessionId}.json`), "utf8"));
    assert.equal(json.messages.length, 1);
    assert.equal(json.messages[0].content, "Fix the responsive drawer layout on mobile");

    // 3. Add Assistant Message
    store.addMessage(sessionId, "assistant", "Adjusted media queries in styles.css to collapse drawer at 768px.");

    json = JSON.parse(fs.readFileSync(path.join(chatsDir, `${sessionId}.json`), "utf8"));
    assert.equal(json.messages.length, 2);
    assert.equal(json.messages[1].role, "assistant");

    // 4. Check Markdown transcript
    const md = fs.readFileSync(path.join(chatsDir, `${sessionId}.md`), "utf8");
    assert.ok(md.includes("Fix responsive layout in CSS"));
    assert.ok(md.includes("Fix the responsive drawer layout on mobile"));
    assert.ok(md.includes("Adjusted media queries in styles.css"));

    // 5. Save task summary
    store.saveTaskSummary(sessionId, "Fix responsive layout", "COMPLETED", "Media queries updated");
    json = JSON.parse(fs.readFileSync(path.join(chatsDir, `${sessionId}.json`), "utf8"));
    assert.equal(json.summary, "Media queries updated");
  } finally {
    db.close();
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test("Chat Storage: enforces max storage limit by automatically deleting oldest chats first", () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "g1code-limit-test-"));
  const chatsDir = path.join(tempWorkspace, "G1Code", "chats");
  fs.mkdirSync(chatsDir, { recursive: true });

  try {
    // Default limit should be 100 MB (104,857,600 bytes)
    assert.equal(ChatStorage.getMaxStorageLimit(), 100 * 1024 * 1024);

    // Create 3 sessions with ascending timestamps (session-1 oldest, session-3 newest)
    const baseDate = new Date("2026-01-01T10:00:00Z").getTime();
    const sessions = [
      {
        id: "session-1",
        workspaceId: tempWorkspace,
        title: "Oldest chat session",
        mode: "agent",
        model: "default",
        provider: "experiential-labs",
        status: "COMPLETED" as const,
        createdAt: new Date(baseDate).toISOString(),
        updatedAt: new Date(baseDate).toISOString(),
      },
      {
        id: "session-2",
        workspaceId: tempWorkspace,
        title: "Middle chat session",
        mode: "agent",
        model: "default",
        provider: "experiential-labs",
        status: "COMPLETED" as const,
        createdAt: new Date(baseDate + 3600000).toISOString(),
        updatedAt: new Date(baseDate + 3600000).toISOString(),
      },
      {
        id: "session-3",
        workspaceId: tempWorkspace,
        title: "Newest chat session",
        mode: "agent",
        model: "default",
        provider: "experiential-labs",
        status: "COMPLETED" as const,
        createdAt: new Date(baseDate + 7200000).toISOString(),
        updatedAt: new Date(baseDate + 7200000).toISOString(),
      },
    ];

    for (const s of sessions) {
      ChatStorage.persistChat(s, [
        { role: "user", content: `Query for ${s.id} with some padding content to take disk space.` },
        { role: "assistant", content: `Response for ${s.id} with detailed answer.` },
      ]);
    }

    // Verify all 3 exist initially
    assert.ok(fs.existsSync(path.join(chatsDir, "session-1.json")));
    assert.ok(fs.existsSync(path.join(chatsDir, "session-2.json")));
    assert.ok(fs.existsSync(path.join(chatsDir, "session-3.json")));

    const totalBefore = ChatStorage.getDirectoryStorageBytes(chatsDir);
    assert.ok(totalBefore > 0, "Directory should have non-zero bytes");

    // Set a threshold smaller than totalBefore, but large enough to keep session-2 and session-3
    const session1Size =
      fs.statSync(path.join(chatsDir, "session-1.json")).size +
      fs.statSync(path.join(chatsDir, "session-1.md")).size;
    const tightLimit = totalBefore - Math.floor(session1Size / 2);

    const result = ChatStorage.enforceStorageLimit(chatsDir, undefined, tightLimit);

    // Oldest (session-1) should have been deleted first!
    assert.ok(result.deletedSessions.includes("session-1"), "Oldest session-1 must be deleted");
    assert.ok(!fs.existsSync(path.join(chatsDir, "session-1.json")), "session-1.json should be removed");
    assert.ok(!fs.existsSync(path.join(chatsDir, "session-1.md")), "session-1.md should be removed");

    // Newer sessions (session-2 and session-3) must remain intact
    assert.ok(fs.existsSync(path.join(chatsDir, "session-2.json")), "session-2.json should remain");
    assert.ok(fs.existsSync(path.join(chatsDir, "session-3.json")), "session-3.json should remain");

    // Storage is now within the tightLimit
    assert.ok(result.totalBytesAfter <= tightLimit, "Storage must return back within limit");

    // Index should reflect eviction
    const indexList = ChatStorage.listChats(tempWorkspace);
    assert.ok(!indexList.some((item) => item.id === "session-1"), "Evicted session must not be in index");
    assert.ok(indexList.some((item) => item.id === "session-2"), "Remaining session-2 must be in index");
    assert.ok(indexList.some((item) => item.id === "session-3"), "Remaining session-3 must be in index");
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test("Chat Storage: ensures cleanup never deletes the currently active chat and isolates non-chat files", () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "g1code-active-protect-"));
  const g1Dir = path.join(tempWorkspace, "G1Code");
  const chatsDir = path.join(g1Dir, "chats");
  fs.mkdirSync(chatsDir, { recursive: true });

  // Place other critical G1Code and workspace files
  const sqliteFake = path.join(g1Dir, "g1code.sqlite");
  fs.writeFileSync(sqliteFake, "SQLITE_DATABASE_MOCK_DATA", "utf8");
  const projectFile = path.join(tempWorkspace, "index.ts");
  fs.writeFileSync(projectFile, "console.log('project code');", "utf8");

  try {
    const baseDate = new Date("2026-01-01T10:00:00Z").getTime();
    // active-session is OLDER than inactive-session
    const activeSession = {
      id: "active-session",
      workspaceId: tempWorkspace,
      title: "Active Chat Session",
      mode: "agent",
      model: "default",
      provider: "experiential-labs",
      status: "RUNNING" as const,
      createdAt: new Date(baseDate).toISOString(),
      updatedAt: new Date(baseDate).toISOString(),
    };

    const otherSession = {
      id: "other-session",
      workspaceId: tempWorkspace,
      title: "Other Chat Session",
      mode: "agent",
      model: "default",
      provider: "experiential-labs",
      status: "COMPLETED" as const,
      createdAt: new Date(baseDate + 3600000).toISOString(),
      updatedAt: new Date(baseDate + 3600000).toISOString(),
    };

    ChatStorage.persistChat(activeSession, [{ role: "user", content: "Active prompt" }]);
    ChatStorage.persistChat(otherSession, [{ role: "user", content: "Other prompt" }]);

    // Enforce an aggressive storage limit with activeSessionId specified
    const result = ChatStorage.enforceStorageLimit(chatsDir, "active-session", 10);

    // Active session must NOT be deleted even though it is older
    assert.ok(fs.existsSync(path.join(chatsDir, "active-session.json")), "Active chat JSON must be protected");
    assert.ok(fs.existsSync(path.join(chatsDir, "active-session.md")), "Active chat MD must be protected");
    assert.ok(!result.deletedSessions.includes("active-session"), "active-session should not be in deleted list");

    // Other session should be deleted
    assert.ok(!fs.existsSync(path.join(chatsDir, "other-session.json")), "Non-active session should be deleted");
    assert.ok(result.deletedSessions.includes("other-session"));

    // Critical non-chat files must remain completely untouched
    assert.ok(fs.existsSync(sqliteFake), "g1code.sqlite must not be affected");
    assert.equal(fs.readFileSync(sqliteFake, "utf8"), "SQLITE_DATABASE_MOCK_DATA");
    assert.ok(fs.existsSync(projectFile), "Project file must not be affected");
    assert.equal(fs.readFileSync(projectFile, "utf8"), "console.log('project code');");
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test("Chat Storage: synchronizes eviction with DatabaseStore to remove deleted sessions from SQLite", () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "g1code-db-sync-test-"));
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE task_summaries (session_id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);

  const store = new DatabaseStore(db);
  const chatsDir = path.join(tempWorkspace, "G1Code", "chats");

  try {
    const baseDate = new Date("2026-01-01T10:00:00Z").getTime();
    const oldSession = {
      id: "evict-old-session",
      workspaceId: tempWorkspace,
      title: "Old Chat to be evicted",
      mode: "agent",
      model: "default",
      provider: "experiential-labs",
      status: "COMPLETED" as const,
      createdAt: new Date(baseDate).toISOString(),
      updatedAt: new Date(baseDate).toISOString(),
    };

    const newSession = {
      id: "keep-new-session",
      workspaceId: tempWorkspace,
      title: "New Chat to keep",
      mode: "agent",
      model: "default",
      provider: "experiential-labs",
      status: "COMPLETED" as const,
      createdAt: new Date(baseDate + 100000).toISOString(),
      updatedAt: new Date(baseDate + 100000).toISOString(),
    };

    store.createSession(oldSession);
    store.addMessage(oldSession.id, "user", "Old message content");
    store.createSession(newSession);
    store.addMessage(newSession.id, "user", "New message content");

    assert.ok(store.getSession("evict-old-session") !== undefined, "Old session should exist in DB");
    assert.ok(store.getSession("keep-new-session") !== undefined, "New session should exist in DB");

    // Trigger enforcement with tight limit to evict the old chat
    ChatStorage.enforceStorageLimit(chatsDir, undefined, 10);

    // Old session should be removed from SQLite database
    assert.equal(store.getSession("evict-old-session"), undefined, "Old session should be removed from DB");
    assert.equal(store.sessionMessages("evict-old-session").length, 0, "Old messages should be removed from DB");

    // New session should also be cleaned up if exceeding 10 bytes, or if activeSession is kept
  } finally {
    store.dispose();
    db.close();
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test("Chat Storage: enforceAllStorageLimits performs reliable cleanup across application restarts", () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "g1code-restart-test-"));
  const chatsDir = path.join(tempWorkspace, "G1Code", "chats");
  fs.mkdirSync(chatsDir, { recursive: true });

  try {
    // Simulate preexisting chat files before app starts
    const oldSession = {
      id: "pre-restart-session",
      workspaceId: tempWorkspace,
      title: "Pre-restart Chat",
      mode: "agent",
      model: "default",
      provider: "experiential-labs",
      status: "COMPLETED" as const,
      createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    };

    ChatStorage.persistChat(oldSession, [
      { role: "user", content: "Pre-existing chat message before restart." },
    ]);

    assert.ok(fs.existsSync(path.join(chatsDir, "pre-restart-session.json")));

    // On application startup / restart, enforceAllStorageLimits is triggered
    const results = ChatStorage.enforceAllStorageLimits(tempWorkspace, undefined, 10);
    assert.ok(results[chatsDir]?.includes("pre-restart-session"));
    assert.ok(!fs.existsSync(path.join(chatsDir, "pre-restart-session.json")));
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});



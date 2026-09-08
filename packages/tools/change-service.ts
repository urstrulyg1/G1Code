import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseStore } from "../database/repositories";
import type { ChangeBatch, FileChange } from "../database/types";
import { applyApprovedChange, contentHash, revertAppliedChange, unifiedDiff } from "./changes";
import { safePath, safeRealPath } from "./workspace";
import { FailureInjector, SimulatedCrashError } from "./failure-injector";

export class ChangeService {
  constructor(private readonly store: DatabaseStore, private readonly workspace: string) {}

  async proposeChange(sessionId: string, requestedPath: string, proposedContent: string) {
    const file = await safeRealPath(this.workspace, requestedPath);
    const originalContent = await fs.readFile(file, "utf8").catch(() => "");
    const relative = path.relative(this.workspace, file);
    const change = this.store.addChange({
      id: randomUUID(), sessionId, path: relative,
      originalHash: contentHash(originalContent), proposedHash: contentHash(proposedContent),
      originalContent, proposedContent, appliedContent: null,
      patch: unifiedDiff(relative, originalContent, proposedContent), status: "PENDING",
    });
    return change;
  }

  getChange(id: string) { return this.store.getChange(id); }
  listPendingChanges(sessionId?: string) { return this.store.pendingChanges(sessionId); }

  authorizeChange(id: string, sessionId: string) {
    const change = this.requireChange(id);
    const session = this.store.getSession(sessionId);
    if (!session || change.sessionId !== sessionId || session.workspaceId !== this.workspace)
      throw new Error("Change does not belong to session and workspace");
    return change;
  }

  approveChange(id: string) {
    const change = this.requireChange(id);
    if (change.status !== "PENDING") throw new Error(`Cannot approve ${change.status} change`);
    if (this.store.transitionChangeStatus(id, "PENDING", "APPROVED") !== 1)
      throw new Error("Change was already decided");
    return this.requireChange(id);
  }
  rejectChange(id: string) {
    const change = this.requireChange(id);
    if (change.status !== "PENDING") throw new Error(`Cannot reject ${change.status} change`);
    if (this.store.transitionChangeStatus(id, "PENDING", "REJECTED") !== 1)
      throw new Error("Change was already decided");
    return this.requireChange(id);
  }
  async applyChange(id: string) {
    const change = this.requireChange(id);
    if (change.status !== "APPROVED") throw new Error(`Change must be approved before applying`);
    if (this.store.transitionChangeStatus(id, "APPROVED", "APPLYING") !== 1)
      throw new Error("Change is already being applied or was applied");
    const result = await applyApprovedChange(this.workspace, change.path, change.originalHash, change.originalContent, change.proposedContent);
    if (result.status === "CONFLICT") {
      this.store.updateChangeStatus(id, "CONFLICT");
      return this.requireChange(id);
    }
    this.store.updateAppliedContent(id, change.proposedContent);
    this.store.updateChangeStatus(id, "APPLIED");
    return this.requireChange(id);
  }
  async applyBatch(sessionId: string, ids: string[]) {
    if (!ids.length) throw new Error("Cannot apply an empty change batch");
    const changes = ids.map((id) => this.authorizeChange(id, sessionId));
    if (changes.some((change) => change.status !== "APPROVED")) throw new Error("Every change must be approved before batch apply");
    const paths = new Set<string>();
    for (const change of changes) {
      if (paths.has(change.path)) throw new Error(`Duplicate path in change batch: ${change.path}`);
      paths.add(change.path);
      const current = await fs.readFile(await safeRealPath(this.workspace, change.path), "utf8").catch(() => null);
      if (current === null || contentHash(current) !== change.originalHash || current !== change.originalContent)
        throw new Error(`Change conflict before batch apply: ${change.path}`);
    }
    FailureInjector.maybeCrash("BEFORE_BATCH_PREPARE");
    const batchId = randomUUID();
    const batch = this.store.createChangeBatch({ id: batchId, sessionId, workspaceId: this.workspace, status: "PENDING", failureReason: null }, changes);
    const tempRoot = await fs.mkdtemp(path.join(this.workspace, ".g1code-batch-"));
    const temporary = new Map<string, string>();
    try {
      this.store.updateChangeBatch(batchId, "PREPARING");
      for (const change of changes) {
        const tempFile = path.join(tempRoot, change.path);
        await fs.mkdir(path.dirname(tempFile), { recursive: true });
        await fs.writeFile(tempFile, change.proposedContent, "utf8");
        const prepared = await fs.readFile(tempFile, "utf8");
        if (contentHash(prepared) !== change.proposedHash) throw new Error(`Temporary content verification failed: ${change.path}`);
        temporary.set(change.id, tempFile);
      }
      FailureInjector.maybeCrash("AFTER_BATCH_PREPARE");
      this.store.updateChangeBatch(batchId, "APPLYING");
      for (const change of changes) {
        if (this.store.transitionChangeStatus(change.id, "APPROVED", "APPLYING") !== 1)
          throw new Error(`Change state changed during batch preparation: ${change.path}`);
      }
      const applied: FileChange[] = [];
      try {
        for (let i = 0; i < changes.length; i++) {
          const change = changes[i];
          if (i === 0) FailureInjector.maybeCrash("BEFORE_FILE_REPLACE");
          if (i > 0) FailureInjector.maybeCrash("BETWEEN_FILE_REPLACEMENTS");
          const target = await safeRealPath(this.workspace, change.path);
          await fs.rename(temporary.get(change.id)!, target);
          this.store.updateChangeBatchItem(batchId, change.id, "APPLIED");
          this.store.updateAppliedContent(change.id, change.proposedContent);
          this.store.updateChangeStatus(change.id, "APPLIED");
          applied.push(change);
        }
        FailureInjector.maybeCrash("AFTER_FILE_REPLACE");
        FailureInjector.maybeCrash("BEFORE_DB_COMMIT");
        this.store.updateChangeBatch(batchId, "APPLIED");
        FailureInjector.maybeCrash("AFTER_DB_COMMIT");
        return { batch: this.store.changeBatch(batchId), changes: changes.map((change) => this.requireChange(change.id)) };
      } catch (error) {
        if (error instanceof SimulatedCrashError && (error.point === "AFTER_FILE_REPLACE" || error.point === "BEFORE_DB_COMMIT")) {
          throw error;
        }
        this.store.updateChangeBatch(batchId, "ROLLING_BACK", error instanceof Error ? error.message : String(error));
        let rollbackFailed = false;
        FailureInjector.maybeCrash("DURING_ROLLBACK");
        for (const change of applied.reverse()) {
          try {
            const target = await safePath(this.workspace, change.path);
            await this.atomicWrite(target, change.originalContent);
            this.store.updateChangeBatchItem(batchId, change.id, "ROLLED_BACK");
            this.store.updateChangeStatus(change.id, "REVERTED");
          } catch {
            rollbackFailed = true;
            this.store.updateChangeBatchItem(batchId, change.id, "UNCERTAIN");
          }
        }
        for (const change of changes) {
          const current = this.store.getChange(change.id);
          if (current?.status === "APPLYING") this.store.updateChangeStatus(change.id, "APPROVED");
        }
        FailureInjector.maybeCrash("AFTER_ROLLBACK");
        this.store.updateChangeBatch(batchId, rollbackFailed ? "PARTIAL_FAILURE" : "ROLLED_BACK", error instanceof Error ? error.message : String(error));
        if (rollbackFailed) throw new Error(`Change batch partially failed; review batch ${batchId}`);
        throw new Error(`Change batch rolled back after failure; batch ${batchId}`);
      }
    } catch (error) {
      if (error instanceof SimulatedCrashError && (error.point === "AFTER_FILE_REPLACE" || error.point === "BEFORE_DB_COMMIT")) {
        throw error;
      }
      this.store.updateChangeBatch(batchId, "FAILED", error instanceof Error ? error.message : String(error));
      for (const change of changes) {
        const current = this.store.getChange(change.id);
        if (current?.status === "APPLYING") this.store.updateChangeStatus(change.id, "APPROVED");
      }
      throw error;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  async recoverActiveBatches() {
    for (const batch of this.store.activeChangeBatches()) {
      const items = this.store.changeBatchItems(batch.id);
      let allOriginal = true;
      let allProposed = true;
      for (const item of items) {
        const current = await fs.readFile(await safeRealPath(this.workspace, item.path), "utf8").catch(() => null);
        allOriginal &&= current !== null && contentHash(current) === item.originalHash;
        allProposed &&= current !== null && contentHash(current) === item.proposedHash;
      }
      if (allOriginal) {
        this.store.updateChangeBatch(batch.id, "ROLLED_BACK", "Recovered before filesystem replacement");
        for (const item of items) {
          this.store.updateChangeBatchItem(batch.id, item.changeId, "ROLLED_BACK");
          const change = this.store.getChange(item.changeId);
          if (change?.status === "APPLYING") this.store.updateChangeStatus(item.changeId, "APPROVED");
        }
      } else if (allProposed) {
        this.store.updateChangeBatch(batch.id, "APPLIED", "Recovered after filesystem replacement");
        for (const item of items) {
          this.store.updateChangeBatchItem(batch.id, item.changeId, "APPLIED");
          const change = this.store.getChange(item.changeId);
          if (change?.status === "APPROVED" || change?.status === "APPLYING") {
            this.store.updateAppliedContent(item.changeId, item.proposedContent);
            this.store.updateChangeStatus(item.changeId, "APPLIED");
          }
        }
      } else {
        this.store.updateChangeBatch(batch.id, "PARTIAL_FAILURE", "Filesystem differs from both batch journal states");
        for (const item of items) this.store.updateChangeBatchItem(batch.id, item.changeId, "UNCERTAIN");
      }
    }
  }
  async revertChange(id: string) {
    const change = this.requireChange(id);
    if (change.status !== "APPLIED" || !change.appliedContent) throw new Error("Only applied changes can be reverted");
    if (this.store.transitionChangeStatus(id, "APPLIED", "APPLYING") !== 1)
      throw new Error("Change is already being reverted or is no longer applied");
    const result = await revertAppliedChange(this.workspace, change.path, change.proposedHash, change.originalContent, change.appliedContent);
    if (result.status === "CONFLICT") { this.store.updateChangeStatus(id, "CONFLICT"); return this.requireChange(id); }
    this.store.updateChangeStatus(id, "REVERTED");
    return this.requireChange(id);
  }
  async detectConflict(id: string) {
    const change = this.requireChange(id);
    const current = await fs.readFile(await safeRealPath(this.workspace, change.path), "utf8").catch(() => null);
    return current === null || contentHash(current) !== change.originalHash;
  }
  private requireChange(id: string) { const change = this.store.getChange(id); if (!change) throw new Error("Change not found"); return change; }
  private async atomicWrite(target: string, content: string) {
    const temporary = `${target}.g1code-revert-${randomUUID()}`;
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, target).catch(async (error) => { await fs.rm(temporary, { force: true }); throw error; });
  }
}

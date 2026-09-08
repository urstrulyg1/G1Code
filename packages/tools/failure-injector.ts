export type CrashPoint =
  | "BEFORE_BATCH_PREPARE"
  | "AFTER_BATCH_PREPARE"
  | "BEFORE_FILE_REPLACE"
  | "AFTER_FILE_REPLACE"
  | "BETWEEN_FILE_REPLACEMENTS"
  | "DURING_ROLLBACK"
  | "AFTER_ROLLBACK"
  | "BEFORE_DB_COMMIT"
  | "AFTER_DB_COMMIT";

export class SimulatedCrashError extends Error {
  constructor(public readonly point: CrashPoint) {
    super(
      `SimulatedCrashError: Deterministic crash triggered at point ${point}`,
    );
    this.name = "SimulatedCrashError";
  }
}

export class FailureInjector {
  private static activePoint: CrashPoint | null = null;
  private static triggeredCount = 0;

  static setCrashPoint(point: CrashPoint | null) {
    this.activePoint = point;
    this.triggeredCount = 0;
  }

  static getActivePoint(): CrashPoint | null {
    return this.activePoint;
  }

  static getTriggeredCount(): number {
    return this.triggeredCount;
  }

  static maybeCrash(point: CrashPoint) {
    if (this.activePoint === point) {
      this.triggeredCount++;
      this.activePoint = null; // One-shot trigger
      throw new SimulatedCrashError(point);
    }
  }

  static reset() {
    this.activePoint = null;
    this.triggeredCount = 0;
  }
}

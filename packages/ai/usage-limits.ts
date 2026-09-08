export type ModelUsageLimit = {
  modelId: string;
  name: string;
  hourlyLimit: number;
  hourlyUsed: number;
  hourlyResetAt: number; // Unix timestamp in ms
  dailyLimit: number;
  dailyUsed: number;
  dailyResetAt: number; // Unix timestamp in ms
  isLimitReached: boolean;
  limitType?: "hourly" | "daily";
};

// Dynamic usage limit configuration — no hardcoded model names, lists, or pricing
export const EXPERIENTIAL_FREE_LIMITS: Record<
  string,
  { hourlyLimit: number; dailyLimit: number }
> = {};

export const DEFAULT_MODEL_LIMITS = {
  hourlyLimit: 30,
  dailyLimit: 150,
};

type UsageRecord = {
  hourlyUsed: number;
  hourlyResetAt: number;
  dailyUsed: number;
  dailyResetAt: number;
};

class UsageLimitManager {
  private usage = new Map<string, UsageRecord>();

  private getNextHourReset(): number {
    const now = Date.now();
    return now + (60 - (new Date(now).getMinutes())) * 60 * 1000 - (new Date(now).getSeconds() * 1000);
  }

  private getNextDayReset(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  private getRecord(modelId: string): UsageRecord {
    let rec = this.usage.get(modelId);
    const now = Date.now();
    if (!rec) {
      rec = {
        hourlyUsed: 0,
        hourlyResetAt: this.getNextHourReset(),
        dailyUsed: 0,
        dailyResetAt: this.getNextDayReset(),
      };
      this.usage.set(modelId, rec);
    }

    // Auto-reset if time has passed
    if (now >= rec.hourlyResetAt) {
      rec.hourlyUsed = 0;
      rec.hourlyResetAt = this.getNextHourReset();
    }
    if (now >= rec.dailyResetAt) {
      rec.dailyUsed = 0;
      rec.dailyResetAt = this.getNextDayReset();
    }

    return rec;
  }

  public getModelUsage(modelId: string, modelName?: string): ModelUsageLimit {
    const limits = EXPERIENTIAL_FREE_LIMITS[modelId] || {
      hourlyLimit: 30,
      dailyLimit: 150,
    };
    const rec = this.getRecord(modelId);

    const isHourlyReached = rec.hourlyUsed >= limits.hourlyLimit;
    const isDailyReached = rec.dailyUsed >= limits.dailyLimit;
    const isLimitReached = isHourlyReached || isDailyReached;

    return {
      modelId,
      name: modelName || modelId,
      hourlyLimit: limits.hourlyLimit,
      hourlyUsed: rec.hourlyUsed,
      hourlyResetAt: rec.hourlyResetAt,
      dailyLimit: limits.dailyLimit,
      dailyUsed: rec.dailyUsed,
      dailyResetAt: rec.dailyResetAt,
      isLimitReached,
      limitType: isDailyReached ? "daily" : isHourlyReached ? "hourly" : undefined,
    };
  }

  public getAllUsage(
    models: Array<{ id: string; name: string }>,
  ): Record<string, ModelUsageLimit> {
    const result: Record<string, ModelUsageLimit> = {};
    for (const m of models) {
      result[m.id] = this.getModelUsage(m.id, m.name);
    }
    return result;
  }

  public checkAndIncrement(
    modelId: string,
  ): { allowed: boolean; limitInfo: ModelUsageLimit } {
    const limitInfo = this.getModelUsage(modelId);
    if (limitInfo.isLimitReached) {
      return { allowed: false, limitInfo };
    }

    const rec = this.getRecord(modelId);
    rec.hourlyUsed += 1;
    rec.dailyUsed += 1;

    return {
      allowed: true,
      limitInfo: this.getModelUsage(modelId),
    };
  }

  // Simulation / test helper
  public setSimulatedLimit(
    modelId: string,
    resetInSeconds = 60,
    type: "hourly" | "daily" = "hourly",
  ): ModelUsageLimit {
    const limits = EXPERIENTIAL_FREE_LIMITS[modelId] || {
      hourlyLimit: 30,
      dailyLimit: 150,
    };
    const resetTime = Date.now() + resetInSeconds * 1000;
    const rec: UsageRecord = {
      hourlyUsed: type === "hourly" ? limits.hourlyLimit : 0,
      hourlyResetAt: type === "hourly" ? resetTime : this.getNextHourReset(),
      dailyUsed: type === "daily" ? limits.dailyLimit : 0,
      dailyResetAt: type === "daily" ? resetTime : this.getNextDayReset(),
    };
    this.usage.set(modelId, rec);
    return this.getModelUsage(modelId);
  }

  public resetModelLimit(modelId: string): ModelUsageLimit {
    this.usage.delete(modelId);
    return this.getModelUsage(modelId);
  }

  public pruneExpiredModels(activeModelIds: Set<string>): string[] {
    const pruned: string[] = [];
    for (const key of this.usage.keys()) {
      if (!activeModelIds.has(key)) {
        this.usage.delete(key);
        pruned.push(key);
      }
    }
    return pruned;
  }
}

export const globalUsageLimitManager = new UsageLimitManager();

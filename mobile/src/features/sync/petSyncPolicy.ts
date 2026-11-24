export function retryDelayMilliseconds(attemptCount: number): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new Error("Retry attempt count must be a positive integer.");
  }
  const exponent = Math.min(attemptCount - 1, 10);
  return Math.min(3_600_000, 5_000 * 2 ** exponent);
}

export function isRetryDue(nextRetryAt: string | null, now: string): boolean {
  if (nextRetryAt === null) return true;
  const retryTime = Date.parse(nextRetryAt);
  const currentTime = Date.parse(now);
  if (!Number.isFinite(retryTime) || !Number.isFinite(currentTime)) return false;
  return retryTime <= currentTime;
}

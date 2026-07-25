export async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await mapper(value);
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

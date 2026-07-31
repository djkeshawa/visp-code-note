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
      // `index` came from the bound above, so the element is there. Skipping the call when it
      // reads as undefined — which `noUncheckedIndexedAccess` invites — would leave a hole in
      // an array whose type promises an `R` at every position, and a caller that indexes or
      // destructures the result would read undefined without a type error to warn it.
      results[index] = await mapper(values[index] as T);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

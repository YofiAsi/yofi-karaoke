/* Serializes jobs for the same song inside this worker so they never share its work directory or processing state. */

const tails = new Map<string, Promise<void>>();

export async function withSongLock<T>(songId: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(songId) ?? Promise.resolve();
  let release: () => void = () => void 0;
  const done = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => done);
  tails.set(songId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (tails.get(songId) === tail) tails.delete(songId);
  }
}

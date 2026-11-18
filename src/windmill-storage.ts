import type { Storage } from './storage.ts';

/** The two calls of Windmill's client that the storage needs. */
export interface ObjectStoreClient {
  loadS3File(object: { s3: string }): Promise<Uint8Array | undefined>;
  writeS3File(object: { s3: string }, content: string | Blob): Promise<unknown>;
}

/**
 * Whether a failed read means "there is no such file", as opposed to the storage being unreachable.
 * The difference matters: a missing record of issued Tickets means none were issued, while an
 * unreachable one must stop the run, or a whole month would be printed again.
 */
export function isMissingFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|not ?found|NoSuchKey|BlobNotFound|does not exist/i.test(message);
}

/** Keeps files in the Windmill workspace's object storage, under a key prefix such as "f/safety/raffle". */
export function createWindmillStorage(client: ObjectStoreClient, prefix: string): Storage {
  const keyOf = (key: string): string => `${prefix.replace(/\/+$/, '')}/${key}`;
  return {
    async read(key) {
      try {
        return (await client.loadS3File({ s3: keyOf(key) })) ?? null;
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    async write(key, data) {
      const content = typeof data === 'string' ? data : new Blob([data as Uint8Array<ArrayBuffer>]);
      await client.writeS3File({ s3: keyOf(key) }, content);
    },
    describe(key) {
      return `object storage: ${keyOf(key)}`;
    },
  };
}

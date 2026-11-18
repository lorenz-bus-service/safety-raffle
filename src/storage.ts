import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Where score files, the record of issued Tickets and the output files are kept.
 * Keys are forward-slash paths such as "scores/2026-10-17.json".
 * The local folder is the only implementation today; object storage for Windmill fits behind the same interface.
 */
export interface Storage {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, data: Uint8Array | string): Promise<void>;
  /** A human-readable location for a key, for log messages and emails. */
  describe(key: string): string;
}

export function createLocalStorage(rootDir: string): Storage {
  const root = resolve(rootDir);
  const pathOf = (key: string): string => {
    const path = resolve(join(root, key));
    if (path !== root && !path.startsWith(root + '/') && !path.startsWith(root + '\\')) {
      throw new Error(`Storage key "${key}" is outside the data folder`);
    }
    return path;
  };

  return {
    async read(key) {
      try {
        return await readFile(pathOf(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(key, data) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Write then rename, so a crash mid-write never leaves a half-written file under the real name.
      const temporary = `${path}.tmp-${process.pid}`;
      await writeFile(temporary, data);
      await rename(temporary, path);
    },
    describe(key) {
      return pathOf(key);
    },
  };
}

export function createMemoryStorage(): Storage & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async read(key) {
      return files.get(key) ?? null;
    },
    async write(key, data) {
      files.set(key, typeof data === 'string' ? new TextEncoder().encode(data) : data);
    },
    describe(key) {
      return `memory:${key}`;
    },
  };
}

export async function readJson<T>(storage: Storage, key: string): Promise<T | null> {
  const data = await storage.read(key);
  if (data === null) return null;
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

export async function writeJson(storage: Storage, key: string, value: unknown): Promise<void> {
  await storage.write(key, JSON.stringify(value, null, 2) + '\n');
}

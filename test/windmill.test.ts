import { describe, expect, it } from 'vitest';
import { resolveRange } from '../src/dates.ts';
import { parseSettings, resolveReferences } from '../src/settings.ts';
import { readJson, writeJson } from '../src/storage.ts';
import { createWindmillStorage, isMissingFile } from '../src/windmill-storage.ts';

function fakeObjectStore(failWith?: string) {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async loadS3File({ s3 }: { s3: string }) {
      if (failWith) throw new Error(failWith);
      const found = objects.get(s3);
      if (!found) throw new Error('Failed to load S3 file: 404 Not Found - Object does not exist');
      return found;
    },
    async writeS3File({ s3 }: { s3: string }, content: string | Blob) {
      objects.set(s3, typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(await content.arrayBuffer()));
    },
  };
}

describe('Windmill object storage', () => {
  it('round-trips text and binary files under the prefix', async () => {
    const store = fakeObjectStore();
    const storage = createWindmillStorage(store, 'f/safety/raffle/');
    await writeJson(storage, 'issued/2026-10.json', [{ driverId: '1' }]);
    await storage.write('output/a.pdf', new Uint8Array([37, 80, 68, 70]));
    expect([...store.objects.keys()]).toEqual(['f/safety/raffle/issued/2026-10.json', 'f/safety/raffle/output/a.pdf']);
    expect(await readJson(storage, 'issued/2026-10.json')).toEqual([{ driverId: '1' }]);
    expect(await storage.read('output/a.pdf')).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it('treats a missing file as absent', async () => {
    expect(await createWindmillStorage(fakeObjectStore(), 'p').read('issued/2026-10.json')).toBeNull();
  });

  it('recognises how Windmill reports a missing Azure blob', () => {
    // Recorded from a real workspace: the outer status is 500, and the 404 is in the text.
    const recorded =
      'Failed to load S3 file: 500 Internal Server Error - Internal: Error retrieving file: Object at location f/safety/raffle/probe/definitely-missing.json not found: Error performing GET https://example.blob.core.windows.net/windmill/f/safety/raffle/probe/definitely-missing.json in 195.692952ms - Server returned non-2xx status code: 404 Not Found';
    expect(isMissingFile(new Error(recorded))).toBe(true);
  });

  it('refuses to treat unreachable storage as a missing file', async () => {
    const storage = createWindmillStorage(fakeObjectStore('Failed to load S3 file: 503 Service Unavailable - upstream timeout'), 'p');
    await expect(storage.read('issued/2026-10.json')).rejects.toThrow(/503/);
    expect(isMissingFile(new Error('Failed to load S3 file: 500 Internal Server Error - connection reset'))).toBe(false);
    expect(isMissingFile(new Error('Failed to load S3 file: 401 Unauthorized'))).toBe(false);
  });
});

describe('settings text', () => {
  it('parses .env-style text', () => {
    expect(
      parseSettings('# comment\nTIME_ZONE=America/Chicago\n\nEXCLUDE_USERNAMES = Shop,Training \nexport LOCALE="en-US"\nEXCLUDE_ATTRIBUTES=Role=Placeholder\nnot a setting\nEMPTY=\r\n'),
    ).toEqual({ TIME_ZONE: 'America/Chicago', EXCLUDE_USERNAMES: 'Shop,Training', LOCALE: 'en-US', EXCLUDE_ATTRIBUTES: 'Role=Placeholder', EMPTY: '' });
  });

  it('fetches referenced variables and resource fields', async () => {
    const source = {
      getVariable: async (path: string) => `secret-of-${path}`,
      getResource: async (path: string) => (path === 'f/resend/windmill' ? { api_key: 're_123' } : null),
    };
    expect(
      await resolveReferences({ SAMSARA_API_TOKEN: '$var:f/samsara/production', RESEND_API_KEY: '$res:f/resend/windmill#api_key', TIME_ZONE: 'America/Chicago' }, source),
    ).toEqual({ SAMSARA_API_TOKEN: 'secret-of-f/samsara/production', RESEND_API_KEY: 're_123', TIME_ZONE: 'America/Chicago' });
    await expect(resolveReferences({ X: '$res:f/resend/windmill#missing' }, source)).rejects.toThrow(/no field "missing"/);
    await expect(resolveReferences({ X: '$res:f/resend/windmill' }, source)).rejects.toThrow(/path#field/);
  });
});

describe('choosing the period', () => {
  const now = new Date('2026-11-18T15:00:00Z');
  it('defaults to last month and accepts a month, a range or a day', () => {
    expect(resolveRange({}, 'America/Chicago', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolveRange({ period: '2026-09', from: '', to: '' }, 'America/Chicago', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolveRange({ from: '2026-11-02', to: '2026-11-03' }, 'America/Chicago', now)).toEqual({ from: '2026-11-02', to: '2026-11-03' });
    expect(resolveRange({ date: '2026-11-17' }, 'America/Chicago', now)).toEqual({ from: '2026-11-17', to: '2026-11-17' });
  });
  it('refuses a range that includes today, or conflicting choices', () => {
    expect(() => resolveRange({ date: '2026-11-18' }, 'America/Chicago', now)).toThrow(/must end before today/);
    expect(() => resolveRange({ period: '2026-11' }, 'America/Chicago', now)).toThrow(/must end before today/);
    expect(() => resolveRange({ period: '2026-10', from: '2026-10-01' }, 'America/Chicago', now)).toThrow(/only one/);
    expect(() => resolveRange({ to: '2026-10-01' }, 'America/Chicago', now)).toThrow(/needs a from date/);
  });
});

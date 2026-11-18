import { describe, expect, it } from 'vitest';
import { collectDays, loadDays, scoreKey } from '../src/collect.ts';
import { createSamsaraClient, SamsaraError } from '../src/samsara.ts';
import { createMemoryStorage, readJson } from '../src/storage.ts';
import type { DayScores } from '../src/tickets.ts';

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(replies: Reply[]): { fetchImpl: typeof fetch; urls: URL[]; auth: string[] } {
  const urls: URL[] = [];
  const auth: string[] = [];
  const fetchImpl = (async (input: URL, init?: RequestInit) => {
    urls.push(new URL(input));
    auth.push((init?.headers as Record<string, string>).Authorization ?? '');
    const reply = replies.shift();
    if (!reply) throw new Error('No more replies scripted');
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls, auth };
}

const client = (replies: Reply[], waits: number[] = []) => {
  const fake = fakeFetch(replies);
  const samsara = createSamsaraClient({
    token: 'secret',
    baseUrl: 'https://api.example.test',
    fetchImpl: fake.fetchImpl,
    sleep: async (ms) => void waits.push(ms),
  });
  return { samsara, ...fake, waits };
};

const scores = (ids: string[]) => ids.map((driverId) => ({ driverId, driverScore: 97, driveDistanceMeters: 100_000 }));

describe('Samsara client', () => {
  it('asks for one window and follows pagination to the end', async () => {
    const { samsara, urls, auth } = client([
      { body: { data: scores(['1', '2']), pagination: { endCursor: 'abc', hasNextPage: true } } },
      { body: { data: scores(['3']), pagination: { endCursor: 'def', hasNextPage: false } } },
    ]);
    const result = await samsara.getDriverScores(new Date('2026-10-17T05:00:00Z'), new Date('2026-10-18T04:59:59Z'));
    expect(result).toEqual([
      { driverId: '1', safetyScore: 97, driveDistanceMeters: 100_000 },
      { driverId: '2', safetyScore: 97, driveDistanceMeters: 100_000 },
      { driverId: '3', safetyScore: 97, driveDistanceMeters: 100_000 },
    ]);
    expect(urls[0]!.pathname).toBe('/safety-scores/drivers');
    expect(urls[0]!.searchParams.get('startTime')).toBe('2026-10-17T05:00:00.000Z');
    expect(urls[0]!.searchParams.get('endTime')).toBe('2026-10-18T04:59:59.000Z');
    expect(urls[0]!.searchParams.has('after')).toBe(false);
    expect(urls[1]!.searchParams.get('after')).toBe('abc');
    expect(auth[0]).toBe('Bearer secret');
  });

  it('retries rate limits, server errors and network failures, honouring Retry-After', async () => {
    const { samsara, waits } = client([
      { status: 429, headers: { 'retry-after': '3' } },
      { status: 503 },
      new Error('socket hang up'),
      { body: { data: scores(['1']) } },
    ]);
    expect(await samsara.getDriverScores(new Date(0), new Date(1))).toHaveLength(1);
    expect(waits).toEqual([3000, 1000, 2000]);
  });

  it('gives up after the last attempt', async () => {
    const { samsara, urls } = client(Array.from({ length: 5 }, () => ({ status: 500 })));
    await expect(samsara.getDriverScores(new Date(0), new Date(1))).rejects.toThrow(/500/);
    expect(urls).toHaveLength(5);
  });

  it('does not retry a rejected token', async () => {
    const { samsara, urls } = client([{ status: 401, body: { message: 'Invalid token' } }]);
    await expect(samsara.getDriverScores(new Date(0), new Date(1))).rejects.toBeInstanceOf(SamsaraError);
    expect(urls).toHaveLength(1);
  });

  it('maps a driver record', async () => {
    const { samsara, urls } = client([
      {
        body: {
          data: [
            {
              id: '55', name: 'Alder, Maren', username: 'ma1001', email: 'maren@example.com', driverActivationStatus: 'deactivated',
              tags: [{ id: '1', name: 'North Depot' }],
              attributes: [{ name: 'Role', stringValues: ['Placeholder'] }, { name: 'Level', numberValues: [3] }],
              externalIds: { employeeNumber: 'E55' },
            },
            { id: 56 },
          ],
        },
      },
    ]);
    const drivers = await samsara.listDrivers('deactivated');
    expect(urls[0]!.searchParams.get('driverActivationStatus')).toBe('deactivated');
    expect(drivers[0]).toEqual({
      id: '55', name: 'Alder, Maren', username: 'ma1001', email: 'maren@example.com', active: false,
      tags: ['North Depot'], attributes: { Role: ['Placeholder'], Level: ['3'] }, externalIds: { employeeNumber: 'E55' },
    });
    expect(drivers[1]).toMatchObject({ id: '56', name: '', username: '', email: '', tags: [] });
  });
});

describe('collection', () => {
  const at = (iso: string) => () => new Date(iso);

  it('stores one file per day and reports a failed day without stopping', async () => {
    const storage = createMemoryStorage();
    const { samsara, urls } = client([
      { body: { data: scores(['2', '1']) } },
      { status: 401 },
      { body: { data: [] } },
    ]);
    const result = await collectDays(['2026-10-01', '2026-10-02', '2026-10-03'], {
      samsara, storage, timeZone: 'America/Chicago', now: at('2026-11-03T15:00:00Z'),
    });
    expect(result.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-03']);
    expect(result.failures.map((f) => f.date)).toEqual(['2026-10-02']);
    expect(urls[0]!.searchParams.get('startTime')).toBe('2026-10-01T05:00:00.000Z');
    const stored = await readJson<DayScores>(storage, scoreKey('2026-10-01'));
    expect(stored).toMatchObject({ date: '2026-10-01', timeZone: 'America/Chicago', collectedAt: '2026-11-03T15:00:00.000Z' });
    expect(stored!.scores.map((s) => s.driverId)).toEqual(['1', '2']);
    expect(await storage.read(scoreKey('2026-10-02'))).toBeNull();
  });

  it('replaces a stored day on re-collection', async () => {
    const storage = createMemoryStorage();
    const first = client([{ body: { data: [{ driverId: '1', driverScore: 86, driveDistanceMeters: 100_000 }] } }]);
    await collectDays(['2026-10-14'], { samsara: first.samsara, storage, timeZone: 'America/Chicago' });
    const second = client([{ body: { data: [{ driverId: '1', driverScore: 94, driveDistanceMeters: 100_000 }] } }]);
    await collectDays(['2026-10-14'], { samsara: second.samsara, storage, timeZone: 'America/Chicago' });
    expect((await readJson<DayScores>(storage, scoreKey('2026-10-14')))!.scores[0]!.safetyScore).toBe(94);
  });

  it('reuses days collected in the last few hours only when asked, and never across time zones', async () => {
    const storage = createMemoryStorage();
    const options = { storage, timeZone: 'America/Chicago' };
    await collectDays(['2026-10-01'], { ...options, samsara: client([{ body: { data: scores(['1']) } }]).samsara, now: at('2026-11-03T15:00:00Z') });

    const soon = client([]);
    const reused = await collectDays(['2026-10-01'], { ...options, samsara: soon.samsara, now: at('2026-11-03T16:00:00Z'), reuseFresh: true });
    expect(reused.reused).toEqual(['2026-10-01']);
    expect(soon.urls).toHaveLength(0);

    const later = client([{ body: { data: scores(['1']) } }]);
    await collectDays(['2026-10-01'], { ...options, samsara: later.samsara, now: at('2026-11-04T16:00:00Z'), reuseFresh: true });
    expect(later.urls).toHaveLength(1);

    const otherZone = client([{ body: { data: scores(['1']) } }]);
    await collectDays(['2026-10-01'], { storage, timeZone: 'America/Denver', samsara: otherZone.samsara, now: at('2026-11-04T16:30:00Z'), reuseFresh: true });
    expect(otherZone.urls).toHaveLength(1);
  });

  it('reports days with no stored file when loading', async () => {
    const storage = createMemoryStorage();
    await collectDays(['2026-10-01'], { samsara: client([{ body: { data: [] } }]).samsara, storage, timeZone: 'America/Chicago' });
    const result = await loadDays(['2026-10-01', '2026-10-02'], storage);
    expect(result.days).toHaveLength(1);
    expect(result.failures.map((f) => f.date)).toEqual(['2026-10-02']);
  });
});

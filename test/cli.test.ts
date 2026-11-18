import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayWindow } from '../src/dates.ts';
import { roster, sampleMonth } from './fixtures/roster.ts';

/** Runs the real command line against a local stand-in for the Samsara API. */
let server: Server;
let baseUrl: string;
let dataDir: string;
const requests: string[] = [];

beforeAll(async () => {
  const month = sampleMonth();
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push(url.pathname);
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== 'Bearer test-token') {
      response.statusCode = 401;
      response.end('{"message":"Invalid token"}');
    } else if (url.pathname === '/fleet/drivers') {
      const active = url.searchParams.get('driverActivationStatus') === 'active';
      const data = roster
        .filter((d) => d.active === active)
        .map((d) => ({ id: d.id, name: d.name, username: d.username, email: d.email, tags: d.tags.map((name) => ({ name })) }));
      response.end(JSON.stringify({ data, pagination: { endCursor: '', hasNextPage: false } }));
    } else if (url.pathname === '/safety-scores/drivers') {
      const start = new Date(url.searchParams.get('startTime') ?? '').getTime();
      const day = month.find((d) => dayWindow(d.date, 'America/Chicago').start.getTime() === start);
      const all = (day?.scores ?? []).map((s) => ({ driverId: s.driverId, driverScore: s.safetyScore, driveDistanceMeters: s.driveDistanceMeters }));
      // Two pages per day, to exercise pagination over real HTTP.
      const second = url.searchParams.get('after') === 'page2';
      response.end(JSON.stringify({ data: second ? all.slice(3) : all.slice(0, 3), pagination: { endCursor: 'page2', hasNextPage: !second && all.length > 3 } }));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dataDir = mkdtempSync(join(tmpdir(), 'safety-raffle-'));
  writeFileSync(join(dataDir, 'empty.env'), '');
});

afterAll(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function raffle(args: string[], env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      // An empty settings file, so a developer's own .env never leaks into the tests.
      ['src/cli.ts', ...args, '--env-file', join(dataDir, 'empty.env')],
      { env: { PATH: process.env.PATH ?? '', SAMSARA_API_TOKEN: 'test-token', SAMSARA_API_URL: baseUrl, DATA_DIR: dataDir, ...env } },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, output: stdout + stderr }),
    );
  });
}

describe('command line', () => {
  it('runs a month end to end and writes the files', async () => {
    const { code, output } = await raffle(['run', '--period', '2026-10']);
    expect(output).toContain('time zone America/Chicago');
    expect(code).toBe(0);
    const [runFolder] = readdirSync(join(dataDir, 'output', '2026-10'));
    expect(runFolder).toMatch(/-first$/);
    const files = readdirSync(join(dataDir, 'output', '2026-10', runFolder!)).sort();
    expect(files).toEqual(['summary-2026-10.csv', 'tickets-2026-10.csv', 'tickets-2026-10.pdf']);
    const csv = readFileSync(join(dataDir, 'output', '2026-10', runFolder!, 'tickets-2026-10.csv'), 'utf8').trim().split('\r\n');
    expect(csv[0]).toBe('Surname,FirstName,EmployeeId,Date,SafetyScore,MilesDriven,Group');
    expect(csv.length).toBeGreaterThan(100);
    expect(readdirSync(join(dataDir, 'scores'))).toHaveLength(31);
    expect(existsSync(join(dataDir, 'issued', '2026-10.json'))).toBe(true);
    expect(readdirSync(join(dataDir, 'logs'))).toHaveLength(1);
  });

  it('finds nothing new on an immediate re-run', async () => {
    const { code, output } = await raffle(['run', '--period', '2026-10']);
    expect(code).toBe(0);
    expect(output).toContain('this supplementary run prints 0');
    expect(output).toContain('Reused 31 days');
  });

  it('re-collects a single date on request', async () => {
    requests.length = 0;
    const { code } = await raffle(['collect', '--date', '2026-10-14']);
    expect(code).toBe(0);
    expect(requests.filter((p) => p === '/safety-scores/drivers').length).toBeGreaterThanOrEqual(1);
    expect(requests).not.toContain('/fleet/drivers');
  });

  it('exits with a failure status and no tickets when Samsara rejects the token', async () => {
    const { code, output } = await raffle(['run', '--period', '2026-09'], { SAMSARA_API_TOKEN: 'wrong' });
    expect(code).toBe(1);
    expect(output).toContain('FAILED: 30 of 30 days could not be collected');
    expect(existsSync(join(dataDir, 'output', '2026-09'))).toBe(false);
  });

  it('refuses a period that has not finished, and bad settings', async () => {
    const future = await raffle(['run', '--period', '2999-01']);
    expect(future.code).toBe(1);
    expect(future.output).toContain('must end before today');
    const bad = await raffle(['run', '--period', '2026-10'], { TIME_ZONE: 'Mars/Olympus' });
    expect(bad.code).toBe(1);
    expect(bad.output).toContain('not a recognised time zone');
  });
});

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { scoreKey } from '../src/collect.ts';
import { compareWithReference, parseCsv } from '../src/compare.ts';
import { loadConfig } from '../src/config.ts';
import type { Message, Mailer } from '../src/mail.ts';
import { runRaffle } from '../src/run.ts';
import type { RunOptions } from '../src/run.ts';
import type { SamsaraClient } from '../src/samsara.ts';
import { createMemoryStorage, readJson } from '../src/storage.ts';
import { buildTickets } from '../src/tickets.ts';
import type { DailyScore, Driver } from '../src/tickets.ts';
import { dayWindow } from '../src/dates.ts';
import { roster, score } from './fixtures/roster.ts';

const TZ = 'America/Chicago';
const range = { from: '2026-10-12', to: '2026-10-14' };

/** A stand-in for Samsara holding scores by date, which a test can revise between runs. */
function fakeSamsara(byDate: Record<string, DailyScore[]>, failing: string[] = []) {
  const calls: string[] = [];
  const samsara: SamsaraClient = {
    async listDrivers(status): Promise<Driver[]> {
      calls.push(`drivers:${status}`);
      return roster.filter((d) => d.active === (status === 'active')).map((d) => ({ ...d }));
    },
    async getDriverScores(start) {
      const date = Object.keys(byDate).find((d) => dayWindow(d, TZ).start.getTime() === start.getTime());
      calls.push(`scores:${date}`);
      if (!date) throw new Error(`Unexpected window starting ${start.toISOString()}`);
      if (failing.includes(date)) throw new Error('Samsara returned 503');
      return byDate[date]!.map((s) => ({ ...s }));
    },
  };
  return { samsara, calls, byDate, failing };
}

function harness(env: Record<string, string> = {}, mailFails: (message: Message) => boolean = () => false) {
  const storage = createMemoryStorage();
  const sent: Message[] = [];
  const posts: string[] = [];
  const logs: string[] = [];
  const mailer: Mailer = {
    async send(message) {
      if (mailFails(message)) throw new Error('mailbox unavailable');
      sent.push(message);
    },
  };
  const config = loadConfig({
    SAMSARA_API_TOKEN: 'x', EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'mail.example.com', EMAIL_FROM: 'raffle@example.com',
    ADMIN_EMAILS: 'safety@example.com,ops@example.com', ...env,
  });
  let clock = new Date('2026-11-03T15:00:00Z');
  const deps = (samsara: SamsaraClient) => ({
    config, storage, samsara, mailer,
    notifier: { post: async (text: string) => (posts.push(text), []) },
    log: (m: string) => void logs.push(m),
    now: () => clock,
  });
  const options = (overrides: Partial<RunOptions> = {}): RunOptions => ({
    range, employeeIds: [], mode: config.rerunMode, collect: true, sendAdminEmail: true, sendDriverEmails: true, dryRun: false, ...overrides,
  });
  return { storage, sent, posts, logs, deps, options, advance: (hours: number) => (clock = new Date(clock.getTime() + hours * 3_600_000)) };
}

const october = () =>
  fakeSamsara({
    '2026-10-12': [score('101', 100, 80), score('102', 95, 60), score('107', 100, 90), score('900', 100, 50)],
    '2026-10-13': [score('101', 99, 45), score('102', 86, 120)],
    '2026-10-14': [score('101', 100, 12), score('103', 92, 30)],
  });

describe('the monthly run', () => {
  it('collects every day, writes three files, records the tickets and emails the admins', async () => {
    const h = harness({ EXCLUDE_USERNAMES: 'Shop' });
    const fake = october();
    const result = await runRaffle(h.deps(fake.samsara), h.options());

    expect(result.ok).toBe(true);
    expect(result.issued.map((t) => `${t.employeeId} ${t.date}`)).toEqual([
      'ma1001 2026-10-12', 'ma1001 2026-10-13', 'tb1002 2026-10-12', 'ic1003 2026-10-14', 'of1007 2026-10-12',
    ]);
    expect(fake.calls).toEqual(['scores:2026-10-12', 'scores:2026-10-13', 'scores:2026-10-14', 'drivers:active', 'drivers:deactivated']);
    expect(result.files.map((f) => f.split('/').pop())).toEqual([
      'tickets-2026-10-12_2026-10-14.pdf', 'tickets-2026-10-12_2026-10-14.csv', 'summary-2026-10-12_2026-10-14.csv',
    ]);
    expect((await PDFDocument.load(h.storage.files.get(result.files[0]!)!)).getPageCount()).toBe(1);
    expect(await h.storage.read(scoreKey('2026-10-13'))).not.toBeNull();
    expect(await readJson<unknown[]>(h.storage, 'issued/2026-10.json')).toHaveLength(5);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.to).toEqual(['safety@example.com', 'ops@example.com']);
    expect(h.sent[0]!.attachments!.map((a) => a.contentType)).toEqual(['application/pdf', 'text/csv', 'text/csv']);
    expect(h.sent[0]!.html).toContain('America/Chicago');
    expect(h.posts).toEqual(['Safety raffle: 5 tickets for 4 drivers, 2026-10-12 to 2026-10-14.']);
  });

  it('names a whole month by its month', async () => {
    const h = harness();
    const days = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, [score('101', 100, 80)]]));
    const result = await runRaffle(h.deps(fakeSamsara(days).samsara), h.options({ range: { from: '2026-10-01', to: '2026-10-31' } }));
    expect(result.issued).toHaveLength(31);
    expect(result.files[0]).toMatch(/^output\/2026-10\/20261103T150000Z-first\/tickets-2026-10\.pdf$/);
    expect((await PDFDocument.load(h.storage.files.get(result.files[0]!)!)).getPageCount()).toBe(2);
  });

  it('leaves deactivated drivers out when the setting is off', async () => {
    const h = harness({ INCLUDE_DEACTIVATED_DRIVERS: 'false' });
    const fake = october();
    const result = await runRaffle(h.deps(fake.samsara), h.options());
    expect(fake.calls).not.toContain('drivers:deactivated');
    expect(result.issued.map((t) => t.employeeId)).not.toContain('of1007');
  });
});

describe('all or nothing', () => {
  it('produces no tickets and sends a failure notice when one day cannot be collected', async () => {
    const h = harness();
    const fake = october();
    fake.failing.push('2026-10-13');
    const result = await runRaffle(h.deps(fake.samsara), h.options());

    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
    expect([...h.storage.files.keys()].filter((k) => k.startsWith('output/') || k.startsWith('issued/'))).toEqual([]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.subject).toBe('FAILED: Safety raffle tickets 2026-10-12 to 2026-10-14');
    expect(h.sent[0]!.html).toContain('2026-10-13: Samsara returned 503');
    expect(h.sent[0]!.attachments).toBeUndefined();
    expect(h.posts[0]).toMatch(/FAILED.*1 of 3 days/s);
    expect(fake.calls).not.toContain('drivers:active');
  });

  it('fetches only the missing day when the failed run is started again soon after', async () => {
    const h = harness();
    const fake = october();
    fake.failing.push('2026-10-13');
    await runRaffle(h.deps(fake.samsara), h.options());
    fake.failing.length = 0;
    fake.calls.length = 0;
    h.advance(1);
    const result = await runRaffle(h.deps(fake.samsara), h.options());
    expect(result.ok).toBe(true);
    expect(fake.calls.filter((c) => c.startsWith('scores:'))).toEqual(['scores:2026-10-13']);
    expect(result.issued).toHaveLength(6);
  });

  it('fails when the roster cannot be fetched', async () => {
    const h = harness();
    const fake = october();
    fake.samsara.listDrivers = async () => {
      throw new Error('Samsara returned 500');
    };
    const result = await runRaffle(h.deps(fake.samsara), h.options());
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
  });

  it('still reports failure through Slack and Teams when the mail server is down', async () => {
    const h = harness({}, () => true);
    const fake = october();
    fake.failing.push('2026-10-12');
    const result = await runRaffle(h.deps(fake.samsara), h.options());
    expect(result.ok).toBe(false);
    expect(h.posts).toHaveLength(1);
  });

  it('keeps the tickets but reports a problem when only the admin email fails', async () => {
    const h = harness({}, () => true);
    const result = await runRaffle(h.deps(october().samsara), h.options());
    expect(result.ok).toBe(false);
    expect(result.files).toHaveLength(3);
    expect(await readJson<unknown[]>(h.storage, 'issued/2026-10.json')).toHaveLength(6);
    expect(h.posts[0]).toMatch(/admin email could not be sent/);
  });
});

describe('re-runs', () => {
  const revised = () => {
    const fake = october();
    // Staff dismiss an event: Tobias's 13th goes from 86 to 94. A different review lowers Imani's 14th.
    fake.byDate['2026-10-13'] = [score('101', 99, 45), score('102', 94, 120)];
    fake.byDate['2026-10-14'] = [score('101', 100, 12), score('103', 88, 30)];
    return fake;
  };

  it('prints only the new ticket on a supplementary re-run and reports the one that no longer qualifies', async () => {
    const h = harness();
    const first = await runRaffle(h.deps(october().samsara), h.options());
    expect(first.issued).toHaveLength(6);

    h.advance(24 * 9);
    const second = await runRaffle(h.deps(revised().samsara), h.options());
    expect(second.issued.map((t) => `${t.employeeId} ${t.date}`)).toEqual(['tb1002 2026-10-13']);
    expect(second.noLongerQualifying.map((t) => `${t.employeeId} ${t.date}`)).toEqual(['ic1003 2026-10-14']);
    expect(second.files[0]).toMatch(/-supplementary\/tickets-/);
    expect(second.files[0]).not.toBe(first.files[0]);
    // The earlier ticket stays on record: it is in the driver's hands.
    expect(await readJson<unknown[]>(h.storage, 'issued/2026-10.json')).toHaveLength(7);
    expect(h.sent[1]!.subject).toContain('supplementary re-run');
    expect(h.sent[1]!.html).toContain('Issued earlier but no longer qualifying');
    expect(h.posts[1]).toBe('Safety raffle: 1 additional tickets for 1 drivers, 2026-10-12 to 2026-10-14.');

    h.advance(24);
    const third = await runRaffle(h.deps(revised().samsara), h.options());
    expect(third.ok).toBe(true);
    expect(third.issued).toEqual([]);
    expect(third.files.map((f) => f.split('.').pop())).toEqual(['csv', 'csv']);
    expect(h.posts[2]).toBe('Safety raffle: No new tickets for 2026-10-12 to 2026-10-14.');
  });

  it('reprints everything on a full re-run and resets the record to what now qualifies', async () => {
    const h = harness();
    await runRaffle(h.deps(october().samsara), h.options());
    h.advance(24 * 9);
    const second = await runRaffle(h.deps(revised().samsara), h.options({ mode: 'full' }));
    expect(second.issued).toHaveLength(6);
    expect(second.noLongerQualifying).toHaveLength(1);
    expect(await readJson<unknown[]>(h.storage, 'issued/2026-10.json')).toHaveLength(6);
  });

  it('honours RERUN_MODE from the settings', async () => {
    const h = harness({ RERUN_MODE: 'full' });
    await runRaffle(h.deps(october().samsara), h.options());
    h.advance(24 * 9);
    expect((await runRaffle(h.deps(october().samsara), h.options())).issued).toHaveLength(6);
  });

  it('restricts a re-run to one employee without disturbing the others', async () => {
    const h = harness();
    await runRaffle(h.deps(october().samsara), h.options());
    h.advance(24 * 9);
    const second = await runRaffle(h.deps(revised().samsara), h.options({ employeeIds: ['tb1002'] }));
    expect(second.issued.map((t) => `${t.employeeId} ${t.date}`)).toEqual(['tb1002 2026-10-13']);
    // Imani's revised day is outside this run's scope, so it is not reported here.
    expect(second.noLongerQualifying).toEqual([]);
  });

  it('records nothing and sends nothing on a dry run', async () => {
    const h = harness({ SEND_DRIVER_EMAILS: 'true' });
    const result = await runRaffle(h.deps(october().samsara), h.options({ dryRun: true }));
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(3);
    expect(await h.storage.read('issued/2026-10.json')).toBeNull();
    expect(h.sent).toEqual([]);
    expect(h.posts).toEqual([]);
  });

  it('can generate from stored scores without calling Samsara for them', async () => {
    const h = harness();
    await runRaffle(h.deps(october().samsara), h.options({ dryRun: true }));
    const fake = october();
    const result = await runRaffle(h.deps(fake.samsara), h.options({ collect: false }));
    expect(result.issued).toHaveLength(6);
    expect(fake.calls.filter((c) => c.startsWith('scores:'))).toEqual([]);
  });
});

describe('driver emails', () => {
  it('are off by default', async () => {
    const h = harness();
    await runRaffle(h.deps(october().samsara), h.options());
    expect(h.sent).toHaveLength(1);
  });

  it('go to each driver after the admin email, listing qualifying days only', async () => {
    const h = harness({ SEND_DRIVER_EMAILS: 'true' });
    await runRaffle(h.deps(october().samsara), h.options());
    expect(h.sent.map((m) => m.to.join())).toEqual([
      'safety@example.com,ops@example.com', 'ma1001@example.com', 'tb1002@example.com', 'of1007@example.com', 'safety@example.com,ops@example.com',
    ]);
    const maren = h.sent[1]!;
    expect(maren.subject).toBe('Your safety raffle tickets: 2 for 2026-10-12 to 2026-10-14');
    expect(maren.html).toContain('<strong>2 raffle tickets</strong>');
    expect(maren.html).toContain('>2026-10-13<');
    expect(maren.html).not.toContain('>2026-10-14<');
    expect(maren.attachments).toBeUndefined();
    // Imani has no address in Samsara, and Shop has none either: both are named for the admins.
    expect(h.sent[4]!.subject).toContain('2 not delivered');
    expect(h.sent[4]!.html).toContain('Cedar, Imani [ic1003]');
  });

  it('add non-qualifying days when that switch is on', async () => {
    const h = harness({ SEND_DRIVER_EMAILS: 'true', DRIVER_EMAIL_INCLUDE_NON_QUALIFYING: 'true' });
    await runRaffle(h.deps(october().samsara), h.options());
    const maren = h.sent.find((m) => m.to[0] === 'ma1001@example.com')!;
    expect(maren.html).toContain('Days that did not earn a ticket');
    expect(maren.html).toContain('>2026-10-14<');
  });

  it('do not stop the run when one fails, and the failure is reported to the admins', async () => {
    const h = harness({ SEND_DRIVER_EMAILS: 'true', EXCLUDE_USERNAMES: 'Shop' }, (m) => m.to[0] === 'tb1002@example.com');
    const result = await runRaffle(h.deps(october().samsara), h.options());
    expect(result.ok).toBe(true);
    expect(h.sent.map((m) => m.to[0])).toContain('of1007@example.com');
    expect(h.sent.at(-1)!.html).toContain('Birch, Tobias [tb1002]: mailbox unavailable');
  });

  it('can be skipped for one run', async () => {
    const h = harness({ SEND_DRIVER_EMAILS: 'true' });
    await runRaffle(h.deps(october().samsara), h.options({ sendDriverEmails: false }));
    expect(h.sent).toHaveLength(1);
  });
});

describe('comparison with the earlier script', () => {
  it('reads the earlier CSV format and reports differences both ways', async () => {
    const reference = parseCsv(
      '﻿"Surname","FirstName","EmployeeId","FromDate","ToDate","SafetyScore","MilesDriven"\r\n' +
        '"Alder","Maren","MA1001","2026-10-12 00:00","2026-10-12 23:59","100","80"\r\n' +
        '"Birch","Tobias","tb1002","2026-10-13 00:00","2026-10-13 23:59","91","120"\r\n' +
        '"O""Neil, Jr.","Pat","pn0001","2026-10-12 00:00","2026-10-12 23:59","100","44"\r\n',
    );
    expect(reference[2]!.Surname).toBe('O"Neil, Jr.');
    const { rules } = loadConfig({ SAMSARA_API_TOKEN: 'x' });
    const fake = october();
    const days = Object.entries(fake.byDate).map(([date, scores]) => ({ date, timeZone: TZ, collectedAt: '', scores }));
    const comparison = compareWithReference(buildTickets(roster, days, rules, { employeeIds: ['ma1001', 'tb1002'] }), reference);
    expect(comparison.matched).toBe(1);
    expect(comparison.onlyInReference).toEqual([
      { employeeId: 'tb1002', date: '2026-10-13', seenHere: 'score 86, 120 miles (reference: score 91, 120 miles)' },
      { employeeId: 'pn0001', date: '2026-10-12', seenHere: 'no driving recorded (reference: score 100, 44 miles)' },
    ]);
    expect(comparison.onlyHere.map((t) => `${t.employeeId} ${t.date}`)).toEqual(['ma1001 2026-10-13', 'tb1002 2026-10-12']);
  });
});

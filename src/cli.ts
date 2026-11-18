import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectDays, loadDays } from './collect.ts';
import { compareWithReference, parseCsv } from './compare.ts';
import { ConfigError, loadConfig, splitList } from './config.ts';
import type { Config, RerunMode } from './config.ts';
import { eachDay, monthRange, parseIsoDate, previousMonth, todayIn } from './dates.ts';
import type { DateRange } from './dates.ts';
import { createMailer } from './mail.ts';
import { createNotifier } from './notify.ts';
import { renderTestPage } from './pdf.ts';
import { runRaffle } from './run.ts';
import { createSamsaraClient } from './samsara.ts';
import { createLocalStorage } from './storage.ts';
import { buildTickets } from './tickets.ts';

const HELP = `Safety raffle: turn Samsara driver safety scores into printable raffle tickets.

Usage: npm run raffle -- <command> [options]

Commands
  run          Collect a raffle period, generate tickets and send them. Default period: last month.
  collect      Collect (or re-collect) scores for a date or range without generating tickets.
  compare      Compare this project's tickets with a CSV from the earlier PowerShell script.
  test-page    Write a one-sheet PDF of label outlines for checking printer alignment.

Period options (run, collect, compare)
  --period YYYY-MM         A calendar month.
  --from YYYY-MM-DD        First day of a range.
  --to YYYY-MM-DD          Last day of a range. Defaults to --from.
  --date YYYY-MM-DD        A single day.

Options for run
  --employee-id a,b        Restrict the run to these employee IDs.
  --full                   Reprint every ticket, even those issued by an earlier run.
  --supplementary          Print only tickets not issued by an earlier run.
  --no-collect             Use the score files already stored; do not call Samsara for scores.
  --no-email               Send no email at all.
  --no-driver-emails       Send the admin email but no driver emails.
  --dry-run                Write the files only: record nothing as issued, send nothing.

Options for compare
  --csv <path>             The reference CSV (columns EmployeeId and FromDate). Required.
  --no-collect             Use the score files already stored.

Options for test-page
  --out <path>             Where to write the PDF. Default: test-page.pdf

Common options
  --env-file <path>        Settings file. Default: .env
  --help                   Show this help.
`;

function createLogger(dataDir: string): (message: string) => void {
  const directory = resolve(dataDir, 'logs');
  let file: string | null = null;
  try {
    mkdirSync(directory, { recursive: true });
    file = join(directory, `${new Date().toISOString().slice(0, 10)}.log`);
  } catch {
    // Console logging still works when the log folder cannot be created.
  }
  return (message) => {
    const line = `${new Date().toISOString()} ${message}`;
    console.log(line);
    if (file) {
      try {
        appendFileSync(file, line + '\n');
      } catch {
        file = null;
      }
    }
  };
}

function resolveRange(values: Record<string, string | boolean | undefined>, config: Config): DateRange {
  const text = (name: string): string | undefined => (typeof values[name] === 'string' ? (values[name] as string) : undefined);
  const given = ['period', 'from', 'date'].filter((name) => text(name) !== undefined);
  if (given.length > 1) throw new Error(`Give only one of --period, --from and --date`);
  let range: DateRange;
  if (text('period')) range = monthRange(text('period') as string);
  else if (text('date')) range = { from: text('date') as string, to: text('date') as string };
  else if (text('from')) range = { from: text('from') as string, to: text('to') ?? (text('from') as string) };
  else if (text('to')) throw new Error('--to needs --from');
  else range = previousMonth(config.timeZone);

  parseIsoDate(range.from);
  parseIsoDate(range.to);
  if (range.from > range.to) throw new Error(`The range starts (${range.from}) after it ends (${range.to})`);
  const today = todayIn(config.timeZone);
  if (range.to >= today) {
    throw new Error(`The range must end before today (${today} in ${config.timeZone}); a day's scores are not complete until it is over`);
  }
  return range;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      period: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      date: { type: 'string' },
      'employee-id': { type: 'string' },
      full: { type: 'boolean' },
      supplementary: { type: 'boolean' },
      'no-collect': { type: 'boolean' },
      'no-email': { type: 'boolean' },
      'no-driver-emails': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      csv: { type: 'string' },
      out: { type: 'string' },
      'env-file': { type: 'string' },
      help: { type: 'boolean' },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }
  if (!['run', 'collect', 'compare', 'test-page'].includes(command)) {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }

  const envFile = values['env-file'] ?? '.env';
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  else if (values['env-file']) throw new Error(`Settings file ${envFile} was not found`);

  const config = loadConfig(process.env, { requireSamsara: command !== 'test-page' });

  if (command === 'test-page') {
    const out = values.out ?? 'test-page.pdf';
    writeFileSync(out, await renderTestPage({ layout: config.layout, printOffset: config.printOffset, locale: config.locale }));
    console.log(`Wrote ${resolve(out)} for the ${config.layout.name} layout. Print it on plain paper at 100% scale ("actual size").`);
    return 0;
  }

  const log = createLogger(config.dataDir);
  const storage = createLocalStorage(config.dataDir);
  const samsara = createSamsaraClient({ token: config.samsara.token, baseUrl: config.samsara.baseUrl, log });
  const range = resolveRange(values, config);

  if (command === 'collect') {
    log(`Collecting ${range.from} to ${range.to}, time zone ${config.timeZone}`);
    const collection = await collectDays(eachDay(range), { samsara, storage, timeZone: config.timeZone, log });
    if (collection.failures.length > 0) {
      log(`FAILED: ${collection.failures.length} days could not be collected`);
      return 1;
    }
    log(`Collected ${collection.days.length} days into ${storage.describe('scores')}`);
    return 0;
  }

  if (command === 'compare') {
    if (!values.csv) throw new Error('compare needs --csv <path>');
    const reference = parseCsv(readFileSync(values.csv, 'utf8'));
    const days = eachDay(range);
    const collection = values['no-collect']
      ? await loadDays(days, storage)
      : await collectDays(days, { samsara, storage, timeZone: config.timeZone, log, reuseFresh: true });
    if (collection.failures.length > 0) {
      log(`FAILED: ${collection.failures.length} days are missing, so the comparison would be misleading`);
      return 1;
    }
    const drivers = await samsara.listDrivers('active');
    if (config.includeDeactivatedDrivers) drivers.push(...(await samsara.listDrivers('deactivated')));
    const comparison = compareWithReference(buildTickets(drivers, collection.days, config.rules), reference);
    console.log(`\nReference tickets: ${reference.length}`);
    console.log(`Matched:           ${comparison.matched}`);
    console.log(`Only in reference: ${comparison.onlyInReference.length}`);
    for (const t of comparison.onlyInReference) console.log(`  ${t.employeeId} ${t.date}: here ${t.seenHere}`);
    console.log(`Only here:         ${comparison.onlyHere.length}`);
    for (const t of comparison.onlyHere) console.log(`  ${t.employeeId} ${t.date}: score ${t.safetyScore}, ${t.milesDriven} miles`);
    return comparison.onlyInReference.length + comparison.onlyHere.length === 0 ? 0 : 2;
  }

  if (values.full && values.supplementary) throw new Error('Give only one of --full and --supplementary');
  const mode: RerunMode = values.full ? 'full' : values.supplementary ? 'supplementary' : config.rerunMode;
  const result = await runRaffle(
    { config, storage, samsara, mailer: createMailer(config.email), notifier: createNotifier(config.notify), log },
    {
      range,
      employeeIds: splitList(values['employee-id']),
      mode,
      collect: !values['no-collect'],
      sendAdminEmail: !values['no-email'],
      sendDriverEmails: !values['no-email'] && !values['no-driver-emails'],
      dryRun: values['dry-run'] ?? false,
    },
  );
  return result.ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof ConfigError) console.error(error.message);
    else console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);

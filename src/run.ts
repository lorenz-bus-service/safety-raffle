import { collectDays, loadDays } from './collect.ts';
import type { Config, RerunMode } from './config.ts';
import { eachDay, monthOf, monthRange } from './dates.ts';
import type { DateRange } from './dates.ts';
import { planIssue, readIssued, writeIssued } from './ledger.ts';
import type { IssuePlan } from './ledger.ts';
import type { Mailer } from './mail.ts';
import type { Notifier } from './notify.ts';
import { escapeHtml, htmlTable, summaryCsv, ticketsCsv } from './outputs.ts';
import { renderTickets } from './pdf.ts';
import type { SamsaraClient } from './samsara.ts';
import type { Storage } from './storage.ts';
import { buildTickets, byDriver } from './tickets.ts';
import type { Driver, DriverSummary, Ticket, TicketResult } from './tickets.ts';

export interface RunDeps {
  config: Config;
  storage: Storage;
  samsara: SamsaraClient;
  /** Null when email is switched off. */
  mailer: Mailer | null;
  notifier: Notifier;
  log: (message: string) => void;
  now?: () => Date;
}

export interface RunOptions {
  range: DateRange;
  /** Restrict the run to these Employee IDs. Empty means everyone. */
  employeeIds: string[];
  mode: RerunMode;
  /** False reads the score files already in storage instead of calling Samsara. */
  collect: boolean;
  sendAdminEmail: boolean;
  sendDriverEmails: boolean;
  /** Writes the output files but records nothing as issued and sends no email or notices. */
  dryRun: boolean;
}

export interface RunResult {
  ok: boolean;
  /** Tickets printed by this run. */
  issued: Ticket[];
  noLongerQualifying: IssuePlan['noLongerQualifying'];
  /** Storage keys of the files written. */
  files: string[];
  problems: string[];
}

function periodLabel(range: DateRange): string {
  const month = monthOf(range.from);
  const whole = monthRange(month);
  return whole.from === range.from && whole.to === range.to ? month : `${range.from}_${range.to}`;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The monthly job: collect the Raffle Period, turn it into Tickets, write the files, then send email.
 * Nothing is produced unless every day was collected, and Driver emails go last because they cannot be recalled.
 */
export async function runRaffle(deps: RunDeps, options: RunOptions): Promise<RunResult> {
  const { config, storage, log } = deps;
  const now = deps.now ?? (() => new Date());
  const { range } = options;
  const label = periodLabel(range);
  const span = `${range.from} to ${range.to}`;
  const result: RunResult = { ok: false, issued: [], noLongerQualifying: [], files: [], problems: [] };

  log(`Raffle period ${span}, time zone ${config.timeZone}`);
  log(`Minimum score ${config.rules.minimumScore}, minimum miles ${config.rules.minimumMiles}, mode ${options.mode}`);

  async function fail(reason: string, details: string[]): Promise<RunResult> {
    log(`FAILED: ${reason}`);
    for (const detail of details) log(`  ${detail}`);
    result.problems.push(reason, ...details);
    if (options.dryRun) return result;

    const text = `Safety raffle FAILED for ${span}: ${reason}\n${details.join('\n')}\nNo tickets were produced.`;
    if (deps.mailer && config.email.admins.length > 0) {
      try {
        await deps.mailer.send({
          to: config.email.admins,
          subject: `FAILED: Safety raffle tickets ${span}`,
          html:
            `<p><strong>The safety raffle run for ${escapeHtml(span)} failed and produced no tickets.</strong></p>` +
            `<p>${escapeHtml(reason)}</p><ul>${details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` +
            `<p>Run the job again once the cause is fixed.</p>`,
        });
      } catch (error) {
        log(`Could not email the failure notice: ${errorText(error)}`);
      }
    }
    for (const problem of await deps.notifier.post(text)) log(`Could not post the failure notice: ${problem}`);
    return result;
  }

  // 1. Collect every day, or stop.
  const days = eachDay(range);
  const collection = options.collect
    ? await collectDays(days, { samsara: deps.samsara, storage, timeZone: config.timeZone, now, log, reuseFresh: true })
    : await loadDays(days, storage);
  if (collection.reused.length > 0 && options.collect) {
    log(`Reused ${collection.reused.length} days collected in the last few hours`);
  }
  if (collection.failures.length > 0) {
    return fail(
      `${collection.failures.length} of ${days.length} days could not be collected.`,
      collection.failures.map((f) => `${f.date}: ${f.error}`),
    );
  }

  // 2. The roster.
  let drivers: Driver[];
  try {
    // Active Drivers only: a deactivated Driver has left, and Samsara no longer returns their scores.
    drivers = await deps.samsara.listDrivers('active');
  } catch (error) {
    return fail('The list of drivers could not be fetched from Samsara.', [errorText(error)]);
  }
  log(`${drivers.length} drivers in the roster`);

  // 3. Tickets, and which of them this run prints.
  const built = buildTickets(drivers, collection.days, config.rules, { employeeIds: options.employeeIds });
  const months = [...new Set(days.map(monthOf))];
  const previouslyIssued = await readIssued(storage, months);
  const only = options.employeeIds.map((id) => id.trim().toLowerCase()).filter((id) => id !== '');
  const plan = planIssue(
    built.tickets,
    previouslyIssued,
    options.mode,
    (issued) =>
      issued.date >= range.from &&
      issued.date <= range.to &&
      (only.length === 0 || only.includes(issued.employeeId.trim().toLowerCase())),
    now().toISOString(),
  );
  // A Ticket issued earlier to a Driver who has since been deactivated is not a Revision; leave it out of the report.
  const rosterIds = new Set(drivers.map((driver) => driver.id));
  plan.noLongerQualifying = plan.noLongerQualifying.filter((issued) => rosterIds.has(issued.driverId));
  result.issued = plan.toIssue;
  result.noLongerQualifying = plan.noLongerQualifying;
  const kind = !plan.isRerun ? 'first' : options.mode;
  log(`${built.tickets.length} tickets qualify; this ${kind} run prints ${plan.toIssue.length}`);

  // 4. Files.
  const stamp = now().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const folder = `output/${label}/${stamp}-${kind}`;
  const files: { key: string; filename: string; content: Uint8Array; contentType: string }[] = [];
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
  try {
    if (plan.toIssue.length > 0) {
      const pdf = await renderTickets(plan.toIssue, { layout: config.layout, printOffset: config.printOffset, locale: config.locale });
      files.push({ key: `${folder}/tickets-${label}.pdf`, filename: `tickets-${label}.pdf`, content: pdf, contentType: 'application/pdf' });
    }
    files.push(
      { key: `${folder}/tickets-${label}.csv`, filename: `tickets-${label}.csv`, content: encode(ticketsCsv(plan.toIssue)), contentType: 'text/csv' },
      { key: `${folder}/summary-${label}.csv`, filename: `summary-${label}.csv`, content: encode(summaryCsv(plan.toIssue)), contentType: 'text/csv' },
    );
    for (const file of files) {
      await storage.write(file.key, file.content);
      log(`Wrote ${storage.describe(file.key)}`);
    }
    result.files = files.map((file) => file.key);
    if (!options.dryRun) await writeIssued(storage, months, plan.ledger);
  } catch (error) {
    return fail('The ticket files could not be written.', [errorText(error)]);
  }

  result.ok = true;
  if (options.dryRun) {
    log('Dry run: nothing recorded as issued, no email or notices sent');
    return result;
  }

  // 5. Admin email.
  const summaries = byDriver(plan.toIssue);
  const headline =
    plan.toIssue.length === 0
      ? `No new tickets for ${span}`
      : `${plan.toIssue.length} ${plan.isRerun && options.mode === 'supplementary' ? 'additional ' : ''}tickets for ${summaries.length} drivers, ${span}`;
  if (options.sendAdminEmail && deps.mailer && config.email.admins.length > 0) {
    try {
      await deps.mailer.send({
        to: config.email.admins,
        subject: `Safety raffle tickets ${span}${plan.isRerun ? ` (${kind} re-run)` : ''}`,
        html: adminHtml({ config, span, kind, headline, built, plan, summaries, options }),
        attachments: files,
      });
      log(`Emailed ${config.email.admins.length} admin addresses`);
    } catch (error) {
      result.ok = false;
      result.problems.push(`The tickets were produced, but the admin email could not be sent: ${errorText(error)}`);
      log(result.problems.at(-1) as string);
    }
  }

  // 6. Driver emails, last.
  if (options.sendDriverEmails && config.email.sendDriverEmails && deps.mailer && summaries.length > 0) {
    const report = await emailDrivers(deps.mailer, summaries, built, { config, span, isSupplement: plan.isRerun && options.mode === 'supplementary' });
    log(`Driver emails: ${report.sent} sent, ${report.noAddress.length} without an address, ${report.failed.length} failed`);
    if (report.failed.length > 0) result.problems.push(...report.failed.map((f) => `Driver email to ${f.name} failed: ${f.error}`));
    if (options.sendAdminEmail && config.email.admins.length > 0 && (report.noAddress.length > 0 || report.failed.length > 0)) {
      try {
        await deps.mailer.send({
          to: config.email.admins,
          subject: `Safety raffle driver emails ${span}: ${report.noAddress.length + report.failed.length} not delivered`,
          html:
            `<p>${report.sent} driver emails were sent for ${escapeHtml(span)}.</p>` +
            (report.noAddress.length > 0
              ? `<p>No email address in Samsara for:</p><ul>${report.noAddress.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
              : '') +
            (report.failed.length > 0
              ? `<p>Sending failed for:</p><ul>${report.failed.map((f) => `<li>${escapeHtml(f.name)}: ${escapeHtml(f.error)}</li>`).join('')}</ul>`
              : ''),
        });
      } catch (error) {
        log(`Could not email the driver email report: ${errorText(error)}`);
      }
    }
  }

  // 7. Slack and Teams.
  if (!result.ok) {
    for (const problem of await deps.notifier.post(`Safety raffle for ${span}: ${result.problems.join('; ')}`)) log(`Could not post: ${problem}`);
  } else if (config.notify.onSuccess) {
    for (const problem of await deps.notifier.post(`Safety raffle: ${headline}.`)) log(`Could not post: ${problem}`);
  }
  log(headline);
  return result;
}

function adminHtml(input: {
  config: Config;
  span: string;
  kind: string;
  headline: string;
  built: TicketResult;
  plan: IssuePlan;
  summaries: DriverSummary[];
  options: RunOptions;
}): string {
  const { config, built, plan, summaries, options } = input;
  const facts: (string | number)[][] = [
    ['Raffle period', input.span],
    ['Time zone', config.timeZone],
    ['Minimum score', config.rules.minimumScore],
    ['Minimum miles (must be exceeded)', config.rules.minimumMiles],
    ['Run', input.kind],
    ['Tickets in this run', plan.toIssue.length],
    ['Tickets qualifying in total', built.tickets.length],
    ['Label sheet', config.layout.name],
    ['Drivers excluded by rule', built.excludedDrivers.length],
  ];
  if (options.employeeIds.length > 0) facts.push(['Restricted to employee IDs', options.employeeIds.join(', ')]);
  if (built.unknownDriverIds.length > 0) facts.push(['Scores for drivers not on the active roster (ignored)', built.unknownDriverIds.length]);

  let html = `<div style="font-family:sans-serif;font-size:14px"><p><strong>${escapeHtml(input.headline)}</strong></p>`;
  html += htmlTable(['Setting', 'Value'], facts);
  if (plan.noLongerQualifying.length > 0) {
    html +=
      `<p><strong>Issued earlier but no longer qualifying.</strong> These tickets were printed by an earlier run. ` +
      `A later score revision means they would not be earned now. They have not been withdrawn; what to do is your decision.</p>` +
      htmlTable(
        ['Driver', 'Employee ID', 'Date'],
        plan.noLongerQualifying.map((t) => [`${t.surname}, ${t.firstName}`, t.employeeId, t.date]),
      );
  }
  if (summaries.length > 0) {
    html +=
      `<p>Tickets per driver:</p>` +
      htmlTable(
        ['Driver', 'Employee ID', 'Tickets'],
        summaries.map((d) => [`${d.surname}, ${d.firstName}`, d.employeeId, d.tickets.length]),
      );
  }
  return html + '</div>';
}

interface DriverEmailReport {
  sent: number;
  noAddress: string[];
  failed: { name: string; error: string }[];
}

async function emailDrivers(
  mailer: Mailer,
  summaries: DriverSummary[],
  built: TicketResult,
  context: { config: Config; span: string; isSupplement: boolean },
): Promise<DriverEmailReport> {
  const report: DriverEmailReport = { sent: 0, noAddress: [], failed: [] };
  const { config } = context;
  const row = (t: Ticket): (string | number)[] => [t.date, t.safetyScore, t.milesDriven];

  for (const driver of summaries) {
    const name = `${driver.surname}, ${driver.firstName} [${driver.employeeId}]`;
    if (driver.email.trim() === '') {
      report.noAddress.push(name);
      continue;
    }
    const count = driver.tickets.length;
    const noun = `${context.isSupplement ? 'additional ' : ''}raffle ticket${count === 1 ? '' : 's'}`;
    let html =
      `<div style="font-family:sans-serif;font-size:14px"><p>Hello ${escapeHtml(driver.firstName || driver.surname)},</p>` +
      `<p>You earned <strong>${count} ${noun}</strong> for safe driving from ${escapeHtml(context.span)}. ` +
      `A day earns a ticket when your safety score is ${config.rules.minimumScore} or higher and you drove more than ${config.rules.minimumMiles} miles.</p>` +
      htmlTable(['Date', 'Safety score', 'Miles driven'], driver.tickets.map(row));
    if (config.email.includeNonQualifyingDays) {
      const missed = built.nonQualifying.filter((t) => t.driverId === driver.driverId);
      if (missed.length > 0) {
        html += `<p>Days that did not earn a ticket:</p>` + htmlTable(['Date', 'Safety score', 'Miles driven'], missed.map(row));
      }
    }
    html += '</div>';
    try {
      await mailer.send({ to: [driver.email.trim()], subject: `Your safety raffle tickets: ${count} for ${context.span}`, html });
      report.sent += 1;
    } catch (error) {
      report.failed.push({ name, error: errorText(error) });
    }
  }
  return report;
}

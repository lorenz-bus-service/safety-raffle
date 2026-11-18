// The entry point when the project runs as a Windmill script. See docs/windmill.md.
import * as wmill from 'windmill-client';
import { loadConfig } from './config.ts';
import type { RerunMode } from './config.ts';
import { resolveRange } from './dates.ts';
import { createMailer } from './mail.ts';
import { createNotifier } from './notify.ts';
import { runRaffle } from './run.ts';
import { createSamsaraClient } from './samsara.ts';
import { parseSettings, resolveReferences } from './settings.ts';
import { createWindmillStorage } from './windmill-storage.ts';

/**
 * Generates safety raffle tickets. With no period given, it processes last month.
 *
 * @param period A calendar month, YYYY-MM. Leave empty for last month.
 * @param from_date First day of a range, YYYY-MM-DD, as an alternative to a period.
 * @param to_date Last day of the range. Defaults to from_date.
 * @param employee_ids Restrict the run to these employee IDs. Empty means everyone.
 * @param rerun_mode What to print if the period already has tickets. "settings" uses RERUN_MODE.
 * @param dry_run Write the files only: record nothing as issued and send nothing.
 * @param send_admin_email Email the files to the EMAILS_TO addresses.
 * @param send_driver_emails Email each driver, if SEND_DRIVER_EMAILS is also true in the settings.
 * @param settings_variable Path of the Windmill variable holding the settings, written as in .env.sample.
 * @param storage_prefix Where in the workspace object storage the files are kept.
 */
export async function main(
  period: string = '',
  from_date: string = '',
  to_date: string = '',
  employee_ids: string[] = [],
  rerun_mode: 'settings' | 'supplementary' | 'full' = 'settings',
  dry_run: boolean = false,
  send_admin_email: boolean = true,
  send_driver_emails: boolean = true,
  settings_variable: string = 'f/safety/raffle_settings',
  storage_prefix: string = 'f/safety/raffle',
) {
  const log = (message: string): void => console.log(message);
  const settings = await resolveReferences(parseSettings(await wmill.getVariable(settings_variable)), {
    getVariable: (path) => wmill.getVariable(path),
    getResource: (path) => wmill.getResource(path),
  });
  const config = loadConfig(settings);
  const range = resolveRange({ period, from: from_date, to: to_date }, config.timeZone);
  const mode: RerunMode = rerun_mode === 'settings' ? config.rerunMode : rerun_mode;
  const storage = createWindmillStorage(wmill, storage_prefix);

  const result = await runRaffle(
    {
      config,
      storage,
      samsara: createSamsaraClient({ token: config.samsara.token, baseUrl: config.samsara.baseUrl, log }),
      mailer: createMailer(config.email),
      notifier: createNotifier(config.notify),
      log,
    },
    {
      range,
      employeeIds: employee_ids.map((id) => id.trim()).filter((id) => id !== ''),
      mode,
      collect: true,
      sendAdminEmail: send_admin_email,
      sendDriverEmails: send_driver_emails,
      dryRun: dry_run,
    },
  );

  // Failing the job is what makes Windmill show the run as failed and call its error handler.
  if (!result.ok) throw new Error(result.problems.join('\n'));

  return {
    period: `${range.from} to ${range.to}`,
    tickets: result.issued.length,
    drivers: new Set(result.issued.map((ticket) => ticket.driverId)).size,
    no_longer_qualifying: result.noLongerQualifying.length,
    dry_run,
    // Windmill shows these as downloadable files.
    files: result.files.map((key) => ({ s3: `${storage_prefix.replace(/\/+$/, '')}/${key}` })),
  };
}

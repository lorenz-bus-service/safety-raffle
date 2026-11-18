import { dayWindow } from './dates.ts';
import type { IsoDate } from './dates.ts';
import type { SamsaraClient } from './samsara.ts';
import { readJson, writeJson } from './storage.ts';
import type { Storage } from './storage.ts';
import type { DayScores } from './tickets.ts';

/** A score file younger than this is reused when a failed run is started again. */
export const FRESH_FOR_MS = 6 * 60 * 60 * 1000;

export const scoreKey = (date: IsoDate): string => `scores/${date}.json`;

export interface CollectionResult {
  days: DayScores[];
  failures: { date: IsoDate; error: string }[];
  reused: IsoDate[];
}

export interface CollectOptions {
  samsara: SamsaraClient;
  storage: Storage;
  timeZone: string;
  now?: () => Date;
  log?: (message: string) => void;
  /** When true, days collected within the last few hours are kept instead of fetched again. */
  reuseFresh?: boolean;
}

/**
 * Collects each day's Daily Scores from Samsara and stores one file per day, replacing any earlier file.
 * A day that fails is reported and does not stop the remaining days.
 */
export async function collectDays(dates: IsoDate[], options: CollectOptions): Promise<CollectionResult> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const result: CollectionResult = { days: [], failures: [], reused: [] };

  for (const date of dates) {
    if (options.reuseFresh) {
      const existing = await readJson<DayScores>(options.storage, scoreKey(date));
      const age = existing ? now().getTime() - new Date(existing.collectedAt).getTime() : Infinity;
      if (existing && existing.timeZone === options.timeZone && age >= 0 && age < FRESH_FOR_MS) {
        result.days.push(existing);
        result.reused.push(date);
        continue;
      }
    }
    try {
      const { start, end } = dayWindow(date, options.timeZone);
      const scores = await options.samsara.getDriverScores(start, end);
      scores.sort((a, b) => a.driverId.localeCompare(b.driverId));
      const day: DayScores = { date, timeZone: options.timeZone, collectedAt: now().toISOString(), scores };
      await writeJson(options.storage, scoreKey(date), day);
      result.days.push(day);
      log(`Collected ${date}: ${scores.length} drivers`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failures.push({ date, error: message });
      log(`FAILED to collect ${date}: ${message}`);
    }
  }
  return result;
}

/** Reads already-collected days from storage; days with no file are reported as failures. */
export async function loadDays(dates: IsoDate[], storage: Storage): Promise<CollectionResult> {
  const result: CollectionResult = { days: [], failures: [], reused: [] };
  for (const date of dates) {
    const day = await readJson<DayScores>(storage, scoreKey(date));
    if (day) {
      result.days.push(day);
      result.reused.push(date);
    } else {
      result.failures.push({ date, error: 'No score file has been collected for this day' });
    }
  }
  return result;
}

import type { DailyScore, Driver } from './tickets.ts';

export interface SamsaraClient {
  listDrivers(status: 'active' | 'deactivated'): Promise<Driver[]>;
  /** Every Driver's Safety Score and distance for the window, from GET /safety-scores/drivers. */
  getDriverScores(start: Date, end: Date): Promise<DailyScore[]>;
}

export class SamsaraError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SamsaraError';
    this.status = status;
  }
}

export interface SamsaraOptions {
  token: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  log?: (message: string) => void;
}

interface Page<T> {
  data?: T[];
  pagination?: { endCursor?: string; hasNextPage?: boolean };
}

interface RawDriver {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  driverActivationStatus?: string;
  tags?: { name?: string }[];
  attributes?: { name?: string; stringValues?: string[]; numberValues?: number[] }[];
  externalIds?: Record<string, string>;
}

interface RawScore {
  driverId: string;
  driverScore: number;
  driveDistanceMeters: number;
}

export function createSamsaraClient(options: SamsaraOptions): SamsaraClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 5;
  const log = options.log ?? (() => {});

  async function request<T>(path: string, params: Record<string, string>): Promise<Page<T>> {
    const url = new URL(options.baseUrl + path);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

    let lastError: Error = new Error('No attempt was made');
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let retryAfterMs = 500 * 2 ** (attempt - 1);
      try {
        const response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) return (await response.json()) as Page<T>;

        const body = (await response.text()).slice(0, 300);
        lastError = new SamsaraError(response.status, `Samsara returned ${response.status} for ${path}: ${body}`);
        const temporary = response.status === 429 || response.status >= 500;
        if (!temporary) throw lastError;
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
      } catch (error) {
        if (error instanceof SamsaraError && error.status !== 429 && error.status < 500) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (attempt < maxAttempts) {
        log(`Samsara request failed (attempt ${attempt} of ${maxAttempts}): ${lastError.message}. Retrying in ${retryAfterMs} ms.`);
        await sleep(retryAfterMs);
      }
    }
    throw lastError;
  }

  async function allPages<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const items: T[] = [];
    let after = '';
    for (;;) {
      const page = await request<T>(path, after ? { ...params, after } : params);
      items.push(...(page.data ?? []));
      if (!page.pagination?.hasNextPage || !page.pagination.endCursor) return items;
      after = page.pagination.endCursor;
    }
  }

  return {
    async listDrivers(status) {
      const raw = await allPages<RawDriver>('/fleet/drivers', { driverActivationStatus: status, limit: '512' });
      return raw.map((driver) => ({
        id: String(driver.id),
        name: driver.name ?? '',
        username: driver.username ?? '',
        email: driver.email ?? '',
        active: (driver.driverActivationStatus ?? status) === 'active',
        tags: (driver.tags ?? []).map((tag) => tag.name ?? '').filter((name) => name !== ''),
        attributes: Object.fromEntries(
          (driver.attributes ?? [])
            .filter((attribute) => attribute.name)
            .map((attribute) => [
              attribute.name as string,
              [...(attribute.stringValues ?? []), ...(attribute.numberValues ?? []).map(String)],
            ]),
        ),
        externalIds: driver.externalIds ?? {},
      }));
    },

    async getDriverScores(start, end) {
      const raw = await allPages<RawScore>('/safety-scores/drivers', {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
      return raw.map((score) => ({
        driverId: String(score.driverId),
        safetyScore: score.driverScore,
        driveDistanceMeters: score.driveDistanceMeters ?? 0,
      }));
    },
  };
}

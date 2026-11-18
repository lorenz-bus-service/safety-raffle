import { isValidTimeZone } from './dates.ts';
import { PRESETS, UNIT_TO_POINTS, layoutProblems } from './layouts.ts';
import type { LabelLayout, Unit } from './layouts.ts';

export type RerunMode = 'supplementary' | 'full';
export type EmailTransport = 'none' | 'smtp' | 'graph' | 'resend';

export interface TicketRules {
  minimumScore: number;
  minimumMiles: number;
  excludeUsernames: string[];
  excludeTags: string[];
  /** Attribute name and value pairs; a Driver with any of them is excluded. */
  excludeAttributes: { name: string; value: string }[];
  /** 'username', or the name of a Samsara external ID. */
  employeeIdSource: string;
  /** Tag names, in the order their Tickets should print. Empty means no grouping. */
  groupByTags: string[];
}

export interface Config {
  samsara: { token: string; baseUrl: string };
  timeZone: string;
  locale: string;
  dataDir: string;
  rules: TicketRules;
  includeDeactivatedDrivers: boolean;
  layout: LabelLayout;
  /** Positive values move printing right and down. In points. */
  printOffset: { x: number; y: number };
  rerunMode: RerunMode;
  email: {
    transport: EmailTransport;
    from: string;
    admins: string[];
    sendDriverEmails: boolean;
    includeNonQualifyingDays: boolean;
    smtp: { host: string; port: number; secure: boolean; username: string; password: string };
    graph: { tenantId: string; clientId: string; clientSecret: string };
    resend: { apiKey: string };
  };
  notify: { slackWebhookUrl: string; teamsWebhookUrl: string; onSuccess: boolean };
}

export class ConfigError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`Configuration problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

export function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Builds the configuration from environment variables.
 * `requireSamsara` is false for commands that never call Samsara (the test page).
 */
export function loadConfig(env: Env, options: { requireSamsara?: boolean } = {}): Config {
  const problems: string[] = [];
  const text = (name: string, fallback = ''): string => (env[name] ?? '').trim() || fallback;

  const number = (name: string, fallback: number): number => {
    const raw = text(name);
    if (raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      problems.push(`${name} must be a number, but is "${raw}"`);
      return fallback;
    }
    return value;
  };

  const boolean = (name: string, fallback: boolean): boolean => {
    const raw = text(name).toLowerCase();
    if (raw === '') return fallback;
    if (['true', 'yes', '1', 'on'].includes(raw)) return true;
    if (['false', 'no', '0', 'off'].includes(raw)) return false;
    problems.push(`${name} must be true or false, but is "${raw}"`);
    return fallback;
  };

  const choice = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const raw = text(name).toLowerCase();
    if (raw === '') return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    problems.push(`${name} must be one of ${allowed.join(', ')}, but is "${raw}"`);
    return fallback;
  };

  const token = text('SAMSARA_API_TOKEN');
  if (token === '' && options.requireSamsara !== false) problems.push('SAMSARA_API_TOKEN is not set');

  const timeZone = text('TIME_ZONE', 'America/Chicago');
  if (!isValidTimeZone(timeZone)) problems.push(`TIME_ZONE "${timeZone}" is not a recognised time zone`);

  const excludeAttributes = splitList(env.EXCLUDE_ATTRIBUTES).flatMap((pair) => {
    const separator = pair.indexOf('=');
    if (separator < 1 || separator === pair.length - 1) {
      problems.push(`EXCLUDE_ATTRIBUTES entry "${pair}" must be written as Name=Value`);
      return [];
    }
    return [{ name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim() }];
  });

  const layout = loadLayout(text('LABEL_LAYOUT', 'avery-5160').toLowerCase(), text, number, choice, problems);
  const mmToPoints = UNIT_TO_POINTS.mm;

  const transport = choice('EMAIL_TRANSPORT', ['none', 'smtp', 'graph', 'resend'] as const, 'none');
  const email: Config['email'] = {
    transport,
    from: text('EMAIL_FROM'),
    admins: splitList(env.ADMIN_EMAILS),
    sendDriverEmails: boolean('SEND_DRIVER_EMAILS', false),
    includeNonQualifyingDays: boolean('DRIVER_EMAIL_INCLUDE_NON_QUALIFYING', false),
    smtp: {
      host: text('SMTP_HOST'),
      port: number('SMTP_PORT', 587),
      secure: boolean('SMTP_SECURE', false),
      username: text('SMTP_USERNAME'),
      password: env.SMTP_PASSWORD ?? '',
    },
    graph: {
      tenantId: text('GRAPH_TENANT_ID'),
      clientId: text('GRAPH_CLIENT_ID'),
      clientSecret: text('GRAPH_CLIENT_SECRET'),
    },
    resend: { apiKey: text('RESEND_API_KEY') },
  };

  if (transport !== 'none') {
    if (email.from === '') problems.push(`EMAIL_FROM is required when EMAIL_TRANSPORT is ${transport}`);
    const required: Record<Exclude<EmailTransport, 'none'>, [string, string][]> = {
      smtp: [['SMTP_HOST', email.smtp.host]],
      graph: [
        ['GRAPH_TENANT_ID', email.graph.tenantId],
        ['GRAPH_CLIENT_ID', email.graph.clientId],
        ['GRAPH_CLIENT_SECRET', email.graph.clientSecret],
      ],
      resend: [['RESEND_API_KEY', email.resend.apiKey]],
    };
    for (const [name, value] of required[transport]) {
      if (value === '') problems.push(`${name} is required when EMAIL_TRANSPORT is ${transport}`);
    }
  } else if (email.sendDriverEmails) {
    problems.push('SEND_DRIVER_EMAILS is true but EMAIL_TRANSPORT is none');
  }

  const config: Config = {
    samsara: { token, baseUrl: text('SAMSARA_API_URL', 'https://api.samsara.com').replace(/\/+$/, '') },
    timeZone,
    locale: text('LOCALE', 'en-US'),
    dataDir: text('DATA_DIR', './data'),
    rules: {
      minimumScore: number('MINIMUM_SCORE', 90),
      minimumMiles: number('MINIMUM_MILES', 20),
      excludeUsernames: splitList(env.EXCLUDE_USERNAMES),
      excludeTags: splitList(env.EXCLUDE_TAGS),
      excludeAttributes,
      employeeIdSource: text('EMPLOYEE_ID_SOURCE', 'username'),
      groupByTags: splitList(env.GROUP_BY_TAGS),
    },
    includeDeactivatedDrivers: boolean('INCLUDE_DEACTIVATED_DRIVERS', true),
    layout,
    printOffset: { x: mmToPoints(number('PRINT_OFFSET_X_MM', 0)), y: mmToPoints(number('PRINT_OFFSET_Y_MM', 0)) },
    rerunMode: choice('RERUN_MODE', ['supplementary', 'full'] as const, 'supplementary'),
    email,
    notify: {
      slackWebhookUrl: text('SLACK_WEBHOOK_URL'),
      teamsWebhookUrl: text('TEAMS_WEBHOOK_URL'),
      onSuccess: boolean('NOTIFY_ON_SUCCESS', true),
    },
  };

  try {
    new Intl.DateTimeFormat(config.locale);
  } catch {
    problems.push(`LOCALE "${config.locale}" is not a recognised locale`);
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

function loadLayout(
  name: string,
  text: (name: string, fallback?: string) => string,
  number: (name: string, fallback: number) => number,
  choice: <T extends string>(name: string, allowed: readonly T[], fallback: T) => T,
  problems: string[],
): LabelLayout {
  const fallback = PRESETS['avery-5160'] as LabelLayout;
  if (name !== 'custom') {
    const preset = PRESETS[name];
    if (!preset) {
      problems.push(`LABEL_LAYOUT must be one of ${[...Object.keys(PRESETS), 'custom'].join(', ')}, but is "${name}"`);
      return fallback;
    }
    return preset;
  }

  const unit: Unit = choice('LABEL_UNITS', ['in', 'mm'] as const, 'in');
  const toPoints = UNIT_TO_POINTS[unit];
  const required = (setting: string): number => {
    if (text(setting) === '') {
      problems.push(`${setting} is required when LABEL_LAYOUT is custom`);
      return 0;
    }
    return number(setting, 0);
  };
  const layout: LabelLayout = {
    name: 'custom',
    pageWidth: toPoints(required('LABEL_PAGE_WIDTH')),
    pageHeight: toPoints(required('LABEL_PAGE_HEIGHT')),
    marginTop: toPoints(required('LABEL_MARGIN_TOP')),
    marginLeft: toPoints(required('LABEL_MARGIN_LEFT')),
    columns: required('LABEL_COLUMNS'),
    rows: required('LABEL_ROWS'),
    labelWidth: toPoints(required('LABEL_WIDTH')),
    labelHeight: toPoints(required('LABEL_HEIGHT')),
    gapX: toPoints(number('LABEL_GAP_X', 0)),
    gapY: toPoints(number('LABEL_GAP_Y', 0)),
  };
  if (problems.length === 0) {
    for (const problem of layoutProblems(layout)) problems.push(`Custom label layout: ${problem}`);
  }
  return layout;
}

import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

const base = { SAMSARA_API_TOKEN: 'token' };
const problemsOf = (env: Record<string, string>): string[] => {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
};

describe('configuration', () => {
  it('applies the agreed defaults', () => {
    const config = loadConfig(base);
    expect(config.timeZone).toBe('America/Chicago');
    expect(config.rules.minimumScore).toBe(90);
    expect(config.rules.minimumMiles).toBe(20);
    expect(config.rules.excludeUsernames).toEqual([]);
    expect(config.rules.employeeIdSource).toBe('username');
    expect(config.layout.name).toBe('avery-5160');
    expect(config.rerunMode).toBe('supplementary');
    expect(config.email.transport).toBe('none');
    expect(config.email.sendDriverEmails).toBe(false);
    expect(config.email.includeNonQualifyingDays).toBe(false);
    expect(config.notify.onSuccess).toBe(true);
  });

  it('reports every problem at once', () => {
    const problems = problemsOf({ TIME_ZONE: 'Mars/Olympus', MINIMUM_SCORE: 'high', RERUN_MODE: 'again', EXCLUDE_ATTRIBUTES: 'Role' });
    expect(problems).toHaveLength(5);
    expect(problems.join('\n')).toMatch(/SAMSARA_API_TOKEN/);
    expect(problems.join('\n')).toMatch(/Mars\/Olympus/);
  });

  it('parses lists and exclusion attributes', () => {
    const { rules } = loadConfig({ ...base, EXCLUDE_USERNAMES: ' Shop , Training ,', EXCLUDE_ATTRIBUTES: 'Role=Placeholder, Type = Pool Vehicle' });
    expect(rules.excludeUsernames).toEqual(['Shop', 'Training']);
    expect(rules.excludeAttributes).toEqual([{ name: 'Role', value: 'Placeholder' }, { name: 'Type', value: 'Pool Vehicle' }]);
  });

  it('requires each transport\'s own settings', () => {
    expect(problemsOf({ ...base, EMAIL_TRANSPORT: 'graph', EMAIL_FROM: 'a@example.com' })).toHaveLength(3);
    expect(problemsOf({ ...base, EMAIL_TRANSPORT: 'resend' })).toHaveLength(2);
    expect(problemsOf({ ...base, EMAIL_TRANSPORT: 'smtp', EMAIL_FROM: 'a@example.com', SMTP_HOST: 'mail.example.com' })).toEqual([]);
    expect(problemsOf({ ...base, SEND_DRIVER_EMAILS: 'true' })).toHaveLength(1);
  });

  it('builds a custom layout in millimetres and rejects one that does not fit the page', () => {
    const custom = {
      ...base, LABEL_LAYOUT: 'custom', LABEL_UNITS: 'mm', LABEL_PAGE_WIDTH: '210', LABEL_PAGE_HEIGHT: '297',
      LABEL_MARGIN_TOP: '10', LABEL_MARGIN_LEFT: '5', LABEL_COLUMNS: '2', LABEL_ROWS: '4', LABEL_WIDTH: '100', LABEL_HEIGHT: '60',
    };
    const { layout } = loadConfig(custom);
    expect(layout.columns).toBe(2);
    expect(layout.labelWidth).toBeCloseTo(283.46, 1);
    expect(problemsOf({ ...custom, LABEL_COLUMNS: '3' }).join()).toMatch(/wider than the page/);
    expect(problemsOf({ ...base, LABEL_LAYOUT: 'custom' }).length).toBeGreaterThan(5);
    expect(problemsOf({ ...base, LABEL_LAYOUT: 'avery-9999' })).toHaveLength(1);
  });

  it('converts the print offset from millimetres to points', () => {
    const { printOffset } = loadConfig({ ...base, PRINT_OFFSET_X_MM: '25.4', PRINT_OFFSET_Y_MM: '-12.7' });
    expect(printOffset.x).toBeCloseTo(72);
    expect(printOffset.y).toBeCloseTo(-36);
  });
});

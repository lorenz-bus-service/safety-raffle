import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { PRESETS, labelOrigin, labelsPerSheet, layoutProblems } from '../src/layouts.ts';
import { summaryCsv, ticketsCsv, toCsv } from '../src/outputs.ts';
import { renderTestPage, renderTickets } from '../src/pdf.ts';
import { buildTickets } from '../src/tickets.ts';
import type { Ticket } from '../src/tickets.ts';
import { roster, sampleMonth } from './fixtures/roster.ts';

const options = (layoutName = 'avery-5160') => ({ layout: PRESETS[layoutName]!, printOffset: { x: 0, y: 0 }, locale: 'en-US' });
const ticket = (n: number, group = ''): Ticket => ({
  driverId: `${n}`, employeeId: `id${n}`, firstName: 'Test', surname: `Driver${n}`, email: '', date: '2026-10-01', safetyScore: 100, milesDriven: 1234, group,
});
const pages = async (pdf: Uint8Array) => (await PDFDocument.load(pdf)).getPages();

describe('label layouts', () => {
  it('every preset fits its page', () => {
    for (const layout of Object.values(PRESETS)) expect(layoutProblems(layout), layout.name).toEqual([]);
  });

  it('places Avery 5160 labels where the sheet has them', () => {
    const layout = PRESETS['avery-5160']!;
    expect(labelsPerSheet(layout)).toBe(30);
    expect(labelOrigin(layout, 0)).toEqual({ x: 13.5, top: 36 });
    // Second column starts 2.75" to the right; second row 1" down.
    expect(labelOrigin(layout, 1).x).toBeCloseTo(13.5 + 198);
    expect(labelOrigin(layout, 3)).toEqual({ x: 13.5, top: 108 });
    // The last label ends half an inch above the bottom edge and 3/16" inside the right edge.
    const last = labelOrigin(layout, 29);
    expect(last.top + layout.labelHeight).toBeCloseTo(792 - 36);
    expect(last.x + layout.labelWidth).toBeCloseTo(612 - 13.5);
  });

  it('centres Avery 5371 cards on the sheet', () => {
    const layout = PRESETS['avery-5371']!;
    expect(labelsPerSheet(layout)).toBe(10);
    const last = labelOrigin(layout, 9);
    expect(last.x + layout.labelWidth).toBeCloseTo(612 - 54);
    expect(last.top + layout.labelHeight).toBeCloseTo(792 - 36);
  });
});

describe('ticket PDF', () => {
  it('fills sheets in order and starts a new sheet only when one is full', async () => {
    const count = async (n: number) => (await pages(await renderTickets(Array.from({ length: n }, (_, i) => ticket(i)), options()))).length;
    expect(await count(1)).toBe(1);
    expect(await count(30)).toBe(1);
    expect(await count(31)).toBe(2);
    expect(await count(2447)).toBe(82);
  });

  it('uses the page size of the layout', async () => {
    const [letter] = await pages(await renderTickets([ticket(1)], options()));
    expect(letter!.getSize()).toEqual({ width: 612, height: 792 });
    const [a4] = await pages(await renderTickets([ticket(1)], options('avery-l7160')));
    expect(a4!.getSize().width).toBeCloseTo(595.28, 1);
  });

  it('starts each tag group on a new sheet', async () => {
    const tickets = [ticket(1, 'North'), ticket(2, 'North'), ticket(3, 'South'), ticket(4, '')];
    expect(await pages(await renderTickets(tickets, options()))).toHaveLength(3);
  });

  it('prints names the built-in fonts cannot draw instead of failing', async () => {
    const names: Ticket[] = [
      { ...ticket(1), firstName: 'Zoë', surname: 'Élan-Østergård' },
      { ...ticket(2), firstName: 'Łukasz', surname: 'Nguyễn' },
      { ...ticket(3), firstName: '光', surname: 'Wojciechowski-Featherstonehaugh-Montgomery' },
    ];
    expect(await pages(await renderTickets(names, options()))).toHaveLength(1);
  });

  it('renders a full invented month on every preset', async () => {
    const { rules } = loadConfig({ SAMSARA_API_TOKEN: 'x' });
    const { tickets } = buildTickets(roster, sampleMonth(), rules);
    expect(tickets.length).toBeGreaterThan(50);
    for (const name of Object.keys(PRESETS)) {
      const sheets = await pages(await renderTickets(tickets, options(name)));
      expect(sheets, name).toHaveLength(Math.ceil(tickets.length / labelsPerSheet(PRESETS[name]!)));
    }
  });

  it('writes a one-sheet alignment test page', async () => {
    expect(await pages(await renderTestPage(options()))).toHaveLength(1);
  });
});

describe('CSV files', () => {
  it('quotes cells that need it', () => {
    expect(toCsv(['a', 'b'], [['plain', 'has, comma'], ['say "hi"', 7]])).toBe('a,b\r\nplain,"has, comma"\r\n"say ""hi""",7\r\n');
  });

  it('lists one row per ticket and one per driver', () => {
    const tickets = [ticket(1), { ...ticket(1), date: '2026-10-02' }, ticket(2)];
    expect(ticketsCsv(tickets).trim().split('\r\n')).toHaveLength(4);
    expect(summaryCsv(tickets)).toBe(
      'Surname,FirstName,EmployeeId,Tickets,Group,Email\r\nDriver1,Test,id1,2,,\r\nDriver2,Test,id2,1,,\r\n',
    );
  });
});

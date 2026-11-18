import { byDriver } from './tickets.ts';
import type { Ticket } from './tickets.ts';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** One row per Ticket, in print order. */
export function ticketsCsv(tickets: Ticket[]): string {
  return toCsv(
    ['Surname', 'FirstName', 'EmployeeId', 'Date', 'SafetyScore', 'MilesDriven', 'Group'],
    tickets.map((t) => [t.surname, t.firstName, t.employeeId, t.date, t.safetyScore, t.milesDriven, t.group]),
  );
}

/** One row per Driver with their Ticket count, in print order. */
export function summaryCsv(tickets: Ticket[]): string {
  return toCsv(
    ['Surname', 'FirstName', 'EmployeeId', 'Tickets', 'Group', 'Email'],
    byDriver(tickets).map((d) => [d.surname, d.firstName, d.employeeId, d.tickets.length, d.group, d.email]),
  );
}

export function escapeHtml(text: string | number): string {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function htmlTable(header: string[], rows: (string | number)[][]): string {
  const cell = 'padding:4px 10px;border:1px solid #ccc;text-align:left';
  const head = header.map((h) => `<th style="${cell};background:#f2f2f2">${escapeHtml(h)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((v) => `<td style="${cell}">${escapeHtml(v)}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px"><tr>${head}</tr>${body}</table>`;
}

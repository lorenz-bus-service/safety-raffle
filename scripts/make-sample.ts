// Writes docs/sample-tickets.pdf from the invented roster, so the repo shows what the output looks like.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { renderTickets } from '../src/pdf.ts';
import { buildTickets } from '../src/tickets.ts';
import { roster, sampleMonth } from '../test/fixtures/roster.ts';

const config = loadConfig({ SAMSARA_API_TOKEN: 'not-needed', EXCLUDE_USERNAMES: 'Shop', EXCLUDE_ATTRIBUTES: 'Role=Placeholder' });
const { tickets } = buildTickets(roster, sampleMonth(), config.rules);
const pdf = await renderTickets(tickets, { layout: config.layout, printOffset: config.printOffset, locale: config.locale });
writeFileSync('docs/sample-tickets.pdf', pdf);
console.log(`Wrote docs/sample-tickets.pdf: ${tickets.length} invented tickets`);

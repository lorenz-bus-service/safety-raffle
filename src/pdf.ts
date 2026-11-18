import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { formatTicketDate } from './dates.ts';
import { labelOrigin, labelsPerSheet } from './layouts.ts';
import type { LabelLayout } from './layouts.ts';
import type { Ticket } from './tickets.ts';

export interface RenderOptions {
  layout: LabelLayout;
  /** Positive values move printing right and down. In points. */
  printOffset: { x: number; y: number };
  locale: string;
}

/**
 * The built-in PDF fonts cover Western European characters only. Anything else is reduced to its
 * unaccented base letter where one exists, and to "?" otherwise.
 */
function printable(text: string, font: PDFFont): string {
  let result = '';
  for (const character of text) {
    if (canEncode(character, font)) {
      result += character;
      continue;
    }
    const base = character.normalize('NFKD').replace(/\p{M}/gu, '');
    result += base !== '' && [...base].every((c) => canEncode(c, font)) ? base : '?';
  }
  return result;
}

function canEncode(character: string, font: PDFFont): boolean {
  try {
    font.encodeText(character);
    return true;
  } catch {
    return false;
  }
}

/** Draws text no wider than maxWidth: shrinks it down to a minimum size, then cuts it short. */
function drawFitted(page: PDFPage, text: string, font: PDFFont, x: number, y: number, size: number, maxWidth: number): void {
  let fitted = printable(text, font);
  let fittedSize = size;
  const minimumSize = Math.min(size, 6);
  while (fittedSize > minimumSize && font.widthOfTextAtSize(fitted, fittedSize) > maxWidth) fittedSize -= 0.5;
  while (fitted.length > 1 && font.widthOfTextAtSize(fitted, fittedSize) > maxWidth) fitted = fitted.slice(0, -1);
  page.drawText(fitted, { x, y, size: fittedSize, font, color: rgb(0, 0, 0) });
}

function drawTicket(page: PDFPage, ticket: Ticket, x: number, top: number, fonts: Fonts, options: RenderOptions): void {
  const { layout } = options;
  const padding = Math.min(9, layout.labelWidth * 0.06);
  const width = layout.labelWidth - 2 * padding;
  // Three lines of text share the label height; the size is capped so large cards do not get huge type.
  const size = Math.min(14, layout.labelHeight / 4.6);
  const lineHeight = Math.min(layout.labelHeight / 3, size * 1.6);
  const blockTop = top - (layout.labelHeight - 3 * lineHeight) / 2;
  const left = x + padding;
  // Each line's baseline sits so the text is vertically centred in its third of the block.
  const baseline = (line: number): number => blockTop - lineHeight * (line - 0.5) - size * 0.35;

  const name = `${ticket.firstName} ${ticket.surname}`.trim();
  drawFitted(page, name, fonts.bold, left, baseline(1), size, width);
  drawFitted(page, `Date: ${formatTicketDate(ticket.date, options.locale)}`, fonts.regular, left, baseline(2), size, width);

  // The Employee ID sits in small print at the right of the last line.
  const idSize = Math.max(5, size * 0.5);
  const idText = printable(ticket.employeeId, fonts.regular);
  const idWidth = fonts.regular.widthOfTextAtSize(idText, idSize);
  const lastLine = `Score: ${ticket.safetyScore}   Miles: ${ticket.milesDriven.toLocaleString('en-US')}`;
  drawFitted(page, lastLine, fonts.regular, left, baseline(3), size, width - idWidth - 4);
  page.drawText(idText, {
    x: x + layout.labelWidth - padding - idWidth,
    y: baseline(3),
    size: idSize,
    font: fonts.regular,
    color: rgb(0.25, 0.25, 0.25),
  });
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * Lays Tickets out on label sheets, one Ticket per label, in the order given.
 * When Tickets carry a group, each group starts on a new sheet.
 */
export async function renderTickets(tickets: Ticket[], options: RenderOptions): Promise<Uint8Array> {
  const { layout, printOffset } = options;
  const pdf = await PDFDocument.create();
  pdf.setTitle('Safety raffle tickets');
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const perSheet = labelsPerSheet(layout);
  let page: PDFPage | null = null;
  let slot = 0;
  let previousGroup: string | null = null;

  for (const ticket of tickets) {
    const groupChanged = previousGroup !== null && ticket.group !== previousGroup;
    if (page === null || slot === perSheet || groupChanged) {
      page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
      slot = 0;
    }
    previousGroup = ticket.group;
    const origin = labelOrigin(layout, slot);
    drawTicket(page, ticket, origin.x + printOffset.x, layout.pageHeight - origin.top - printOffset.y, fonts, options);
    slot += 1;
  }

  if (page === null) pdf.addPage([layout.pageWidth, layout.pageHeight]);
  return pdf.save();
}

/** One sheet showing the outline of every label, to check alignment on plain paper before using real stock. */
export async function renderTestPage(options: RenderOptions): Promise<Uint8Array> {
  const { layout, printOffset } = options;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Alignment test page: ${layout.name}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([layout.pageWidth, layout.pageHeight]);

  for (let slot = 0; slot < labelsPerSheet(layout); slot++) {
    const origin = labelOrigin(layout, slot);
    const x = origin.x + printOffset.x;
    const top = layout.pageHeight - origin.top - printOffset.y;
    page.drawRectangle({
      x,
      y: top - layout.labelHeight,
      width: layout.labelWidth,
      height: layout.labelHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.5,
    });
    const size = Math.min(9, layout.labelHeight / 5);
    page.drawText(`${slot + 1}`, { x: x + 5, y: top - size - 4, size, font, color: rgb(0.4, 0.4, 0.4) });
    if (slot === 0) {
      page.drawText(printable(`${layout.name} alignment test`, font), {
        x: x + 5,
        y: top - layout.labelHeight / 2 - size / 2,
        size,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }
  return pdf.save();
}

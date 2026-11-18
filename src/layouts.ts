/** A label sheet. All measurements are in PDF points (72 per inch). */
export interface LabelLayout {
  name: string;
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginLeft: number;
  columns: number;
  rows: number;
  labelWidth: number;
  labelHeight: number;
  gapX: number;
  gapY: number;
}

const inch = (value: number): number => value * 72;
const mm = (value: number): number => (value * 72) / 25.4;

export const UNIT_TO_POINTS = { in: inch, mm } as const;
export type Unit = keyof typeof UNIT_TO_POINTS;

export const PRESETS: Record<string, LabelLayout> = {
  // US Letter, 30 address labels per sheet, 1" x 2 5/8".
  'avery-5160': {
    name: 'avery-5160',
    pageWidth: inch(8.5),
    pageHeight: inch(11),
    marginTop: inch(0.5),
    marginLeft: inch(0.1875),
    columns: 3,
    rows: 10,
    labelWidth: inch(2.625),
    labelHeight: inch(1),
    gapX: inch(0.125),
    gapY: 0,
  },
  // US Letter, 10 micro-perforated business cards per sheet, 2" x 3 1/2".
  'avery-5371': {
    name: 'avery-5371',
    pageWidth: inch(8.5),
    pageHeight: inch(11),
    marginTop: inch(0.5),
    marginLeft: inch(0.75),
    columns: 2,
    rows: 5,
    labelWidth: inch(3.5),
    labelHeight: inch(2),
    gapX: 0,
    gapY: 0,
  },
  // A4, 21 address labels per sheet, 63.5 mm x 38.1 mm.
  'avery-l7160': {
    name: 'avery-l7160',
    pageWidth: mm(210),
    pageHeight: mm(297),
    marginTop: mm(15.15),
    marginLeft: mm(7.25),
    columns: 3,
    rows: 7,
    labelWidth: mm(63.5),
    labelHeight: mm(38.1),
    gapX: mm(2.5),
    gapY: 0,
  },
};

export function labelsPerSheet(layout: LabelLayout): number {
  return layout.columns * layout.rows;
}

/** Problems that would stop a layout printing sensibly; empty when the layout is usable. */
export function layoutProblems(layout: LabelLayout): string[] {
  const problems: string[] = [];
  const positive: (keyof LabelLayout)[] = ['pageWidth', 'pageHeight', 'labelWidth', 'labelHeight'];
  for (const key of positive) {
    if (!(Number(layout[key]) > 0)) problems.push(`${key} must be greater than zero`);
  }
  const nonNegative: (keyof LabelLayout)[] = ['marginTop', 'marginLeft', 'gapX', 'gapY'];
  for (const key of nonNegative) {
    if (!(Number(layout[key]) >= 0)) problems.push(`${key} must be zero or more`);
  }
  if (!Number.isInteger(layout.columns) || layout.columns < 1) problems.push('columns must be a whole number of 1 or more');
  if (!Number.isInteger(layout.rows) || layout.rows < 1) problems.push('rows must be a whole number of 1 or more');
  if (problems.length > 0) return problems;

  const usedWidth = layout.marginLeft + layout.columns * layout.labelWidth + (layout.columns - 1) * layout.gapX;
  const usedHeight = layout.marginTop + layout.rows * layout.labelHeight + (layout.rows - 1) * layout.gapY;
  // Half a point of tolerance for unit conversion.
  if (usedWidth > layout.pageWidth + 0.5) problems.push('the labels are wider than the page');
  if (usedHeight > layout.pageHeight + 0.5) problems.push('the labels are taller than the page');
  return problems;
}

/** The top-left corner of a label, measured from the top-left of the page. */
export function labelOrigin(layout: LabelLayout, index: number): { x: number; top: number } {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: layout.marginLeft + column * (layout.labelWidth + layout.gapX),
    top: layout.marginTop + row * (layout.labelHeight + layout.gapY),
  };
}

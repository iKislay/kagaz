import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { makePdf } from '../../../test/fixtures/pdfs.js';
import { buildPrintPacket } from './packet-builder.js';
import { type SlipData } from './slip.js';

const slip: SlipData = {
  pickupNumber: 7,
  pickupDate: '2026-11-07',
  publicRef: 'KGZ-TEST23',
  shopName: 'Kaggaz Demo Shop A - College Road',
  pages: 0,
  copies: 0,
  colour: false,
  duplex: false,
  printedAt: new Date('2026-11-05T10:00:00Z'),
  isDemo: true,
};

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await task.destroy();
  return texts;
}

describe('buildPrintPacket (Appendix A.1, T10 logic)', () => {
  it.each([
    // pages, copies, duplex, expected total pages, spacers
    [3, 1, false, 4, 0],
    [3, 2, false, 7, 0],
    [3, 2, true, 9, 2], // 3+spacer, 3+spacer, slip
    [4, 2, true, 9, 0], // 8 pages even -> slip on page 9 (front)
    [1, 3, true, 7, 3],
    [5, 1, true, 7, 1],
  ])(
    '%i pages x %i copies (duplex=%s) -> %i pages, %i spacers',
    async (pages, copies, duplex, total, spacers) => {
      const packet = await buildPrintPacket(await makePdf(pages), { copies, duplex }, slip);
      expect(packet.pageCount).toBe(total);
      expect(packet.spacerPages).toBe(spacers);
      expect(packet.contentPages).toBe(pages * copies);
      expect(packet.slipIndex).toBe(total - 1);
      if (duplex) expect(packet.slipIndex % 2).toBe(0); // 0-based even = front side
      expect(packet.sha256).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it('honours the page range and keeps copies in order', async () => {
    const packet = await buildPrintPacket(
      await makePdf(6),
      { pageRange: '2-3,5', copies: 2, duplex: false },
      slip,
    );
    const texts = await pageTexts(packet.bytes);
    expect(texts.slice(0, 6).map((t) => t.match(/Test page (\d)/)?.[1])).toEqual([
      '2',
      '3',
      '5',
      '2',
      '3',
      '5',
    ]);
  });

  it('ADR-002: puts exactly one slip at the end with the pickup number + date, ref, no phone', async () => {
    const packet = await buildPrintPacket(
      await makePdf(2),
      { copies: 2, duplex: false },
      {
        ...slip,
        pages: 2,
        copies: 2,
      },
    );
    const texts = await pageTexts(packet.bytes);
    const slipPages = texts.filter((t) => t.includes('PICKUP CODE'));
    expect(slipPages).toHaveLength(1);
    const last = texts.at(-1)!;
    expect(last).toMatch(/#7(?!\d)/);
    expect(last).toContain('7 Nov');
    expect(last).not.toContain('ABCD');
    expect(last).toContain('Kaggaz Demo Shop A');
    expect(last).toContain('KGZ-TEST23');
    expect(last).toContain('REMOVE THIS SLIP BEFORE HANDOVER');
    expect(last).toContain('2 pages x 2 copies');
    expect(last).toContain('DEMO ORDER');
    expect(last).not.toMatch(/\+91|\d{10}/);
  });

  it('normalizes non-A4 pages onto A4 in the matching orientation', async () => {
    const packet = await buildPrintPacket(
      await makePdf(1, [792, 612]), // US Letter landscape
      { copies: 1, duplex: false },
      slip,
    );
    const task = getDocument({ data: packet.bytes.slice(), verbosity: 0 });
    const doc = await task.promise;
    const [, , w, h] = (await doc.getPage(1)).view;
    expect(Math.round(w!)).toBe(842);
    expect(Math.round(h!)).toBe(595);
    await task.destroy();
  });
});

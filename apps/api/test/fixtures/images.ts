/**
 * In-memory test images for the image → PDF path (ADR-005), generated with sharp instead of
 * committed as binaries.
 */
import sharp from 'sharp';

/** A solid-colour JPEG, `width` × `height` as stored (before any EXIF rotation). */
export function makeJpeg(width = 400, height = 300, orientation?: number): Promise<Buffer> {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).jpeg({ quality: 80 });
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer();
}

/** Half-transparent PNG (transparent areas must print white, not black). */
export function makePng(width = 300, height = 400): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
}

export function makeWebp(width = 500, height = 250): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 160, b: 60 } },
  })
    .webp()
    .toBuffer();
}

/** Just the ISO-BMFF header of a HEIC photo: enough for content sniffing. */
export function makeHeicHeader(): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write('ftypheic', 4, 'latin1');
  box.write('mif1heic', 16, 'latin1');
  return box;
}

/** What a .docx really is: a ZIP. */
export function makeZip(): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 0x20)]);
}

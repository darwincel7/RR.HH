import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

// Gemini is replaced by a scripted answer: these tests pin OUR plumbing (extraction,
// selection, cropping), not the model.
const geminiAnswer = vi.fn();
vi.mock('./serverGemini', () => ({
  GEMINI_MODEL: 'test-model',
  getAI: () => ({}),
  generateContentResilient: async (_ai: any, params: any) => ({ text: JSON.stringify(geminiAnswer(params)) }),
}));

import {
  squareCropRect, pngUnfilter, extractPdfImages, harvestCvImages, findCvPhoto, renderAvatar, AVATAR_SIZE,
} from './serverCvPhoto';

/** A fake "photo": a coloured gradient-ish block of the given size. */
const photo = (w: number, h: number, color = { r: 200, g: 120, b: 80 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
const pngPhoto = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 90, b: 160, alpha: 1 } } }).png().toBuffer();

async function pdfWith(images: { kind: 'jpg' | 'png'; bytes: Buffer }[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  for (const [i, img] of images.entries()) {
    const embedded = img.kind === 'jpg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
    page.drawImage(embedded, { x: 20 + i * 150, y: 600, width: 120, height: 150 });
  }
  return Buffer.from(await doc.save());
}

describe('squareCropRect', () => {
  it('centra un cuadrado en la cara con margen', () => {
    // Face occupying x 400-600, y 200-400 of a 1000×1000 image.
    const r = squareCropRect([200, 400, 400, 600], 1000, 1000, 0.25);
    expect(r).toEqual({ left: 350, top: 150, width: 300, height: 300 });
  });
  it('no se sale de la imagen', () => {
    const r = squareCropRect([0, 0, 300, 300], 400, 400, 0.5);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(400);
    expect(r.top + r.height).toBeLessThanOrEqual(400);
  });
  it('acepta coordenadas invertidas o fuera de rango', () => {
    const r = squareCropRect([1200, 800, -50, 100], 500, 500);
    expect(r.width).toBeGreaterThan(0);
    expect(r.left + r.width).toBeLessThanOrEqual(500);
  });
});

describe('pngUnfilter', () => {
  it('deshace los filtros Sub y Up', () => {
    // 2×2 RGB image, row 0 filter Sub(1), row 1 filter Up(2).
    const filtered = Buffer.from([
      1, 10, 20, 30, 5, 5, 5,      // → 10,20,30, 15,25,35
      2, 1, 1, 1, 1, 1, 1,         // → 11,21,31, 16,26,36
    ]);
    expect([...pngUnfilter(filtered, 2, 3)]).toEqual([10, 20, 30, 15, 25, 35, 11, 21, 31, 16, 26, 36]);
  });
});

describe('extractPdfImages', () => {
  it('saca las fotos JPEG y PNG incrustadas en un PDF', async () => {
    const pdf = await pdfWith([
      { kind: 'jpg', bytes: await photo(300, 400) },
      { kind: 'png', bytes: await pngPhoto(200, 200) },
    ]);
    const imgs = await extractPdfImages(pdf);
    expect(imgs).toHaveLength(2);
    const sizes = await Promise.all(imgs.map(async b => { const m = await sharp(b).metadata(); return `${m.width}x${m.height}`; }));
    expect(sizes.sort()).toEqual(['200x200', '300x400']);
  });

  it('descarta íconos pequeños', async () => {
    const pdf = await pdfWith([{ kind: 'jpg', bytes: await photo(32, 32) }]);
    expect(await extractPdfImages(pdf)).toHaveLength(0);
  });

  it('un PDF sin imágenes no da nada', async () => {
    expect(await extractPdfImages(await pdfWith([]))).toHaveLength(0);
  });
});

describe('harvestCvImages', () => {
  it('lee las imágenes de un Word (.docx)', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    zip.file('word/media/image1.jpeg', await photo(240, 320));
    zip.file('word/media/image2.png', await pngPhoto(40, 40)); // icon → dropped
    const docx = await zip.generateAsync({ type: 'nodebuffer' });
    const imgs = await harvestCvImages(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(imgs).toHaveLength(1);
    expect([imgs[0].width, imgs[0].height]).toEqual([240, 320]);
  });

  it('un CV que es una foto se usa tal cual', async () => {
    const imgs = await harvestCvImages(await photo(900, 1200), 'image/jpeg');
    expect(imgs).toHaveLength(1);
  });

  it('descarta franjas y separadores', async () => {
    const imgs = await harvestCvImages(await photo(1200, 80), 'image/jpeg');
    expect(imgs).toHaveLength(0);
  });

  it('un archivo ilegible no rompe nada', async () => {
    expect(await harvestCvImages(Buffer.from('no soy un pdf'), 'application/pdf').catch(() => [])).toEqual([]);
    expect(await harvestCvImages(Buffer.from('no soy un zip'), 'application/msword')).toEqual([]);
  });
});

describe('findCvPhoto', () => {
  beforeEach(() => geminiAnswer.mockReset());

  it('recorta la foto que la IA señala y la deja cuadrada', async () => {
    geminiAnswer.mockReturnValue({ photo_index: 0, box_2d: [100, 200, 500, 600] });
    const pdf = await pdfWith([{ kind: 'jpg', bytes: await photo(300, 400) }]);
    const avatar = await findCvPhoto(pdf, 'application/pdf');
    expect(avatar).not.toBeNull();
    const m = await sharp(avatar!).metadata();
    expect([m.width, m.height, m.format]).toEqual([AVATAR_SIZE, AVATAR_SIZE, 'jpeg']);
  });

  it('sin foto de persona devuelve null', async () => {
    geminiAnswer.mockReturnValue({ photo_index: -1 });
    const pdf = await pdfWith([{ kind: 'jpg', bytes: await photo(300, 300) }]);
    expect(await findCvPhoto(pdf, 'application/pdf')).toBeNull();
  });

  it('ignora un índice inventado por la IA', async () => {
    geminiAnswer.mockReturnValue({ photo_index: 7, box_2d: [0, 0, 10, 10] });
    const pdf = await pdfWith([{ kind: 'jpg', bytes: await photo(300, 300) }]);
    expect(await findCvPhoto(pdf, 'application/pdf')).toBeNull();
  });

  it('no gasta una llamada a la IA si el CV no tiene imágenes', async () => {
    expect(await findCvPhoto(await pdfWith([]), 'application/pdf')).toBeNull();
    expect(geminiAnswer).not.toHaveBeenCalled();
  });
});

describe('renderAvatar', () => {
  it('sin recuadro hace un recorte inteligente cuadrado', async () => {
    const m = await sharp(await renderAvatar(await photo(800, 600), null)).metadata();
    expect([m.width, m.height]).toEqual([AVATAR_SIZE, AVATAR_SIZE]);
  });
});


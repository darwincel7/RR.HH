import zlib from 'zlib';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument, PDFRawStream, PDFName, PDFArray, PDFNumber, PDFDict, PDFRef } from 'pdf-lib';
import { Type, Schema } from '@google/genai';
import { getAI, generateContentResilient, GEMINI_MODEL } from './serverGemini';

/**
 * Finds the applicant's profile photo inside their CV and turns it into a square avatar.
 *
 *  1. Pull every embedded image out of the CV — PDF (JPEG and Flate images), Word
 *     (word/media/*) or the CV itself when it IS a photo/scan.
 *  2. Ask Gemini which of those images contains the person's portrait and where their
 *     face is (a bounding box). Logos, icons, signatures and decorations are rejected.
 *  3. Crop a square around the face (with room for hair and shoulders) → 400×400 JPEG.
 *
 * Pure helpers (crop maths, PNG un-filtering, image harvesting) are exported for tests.
 */

export const AVATAR_SIZE = 400;
/** Images smaller than this (px, shorter side) are icons/bullets, never a portrait. */
const MIN_SIDE = 60;
/** Most images sent to Gemini in one call (bigger CVs: the largest ones win). */
const MAX_CANDIDATES = 6;
/** Refuse to decode absurdly large embedded images (decompression bombs). */
const MAX_PIXELS = 25_000_000;

export interface CvImage {
  /** Re-encoded as JPEG, longest side ≤ 1600px — what Gemini sees AND what gets cropped. */
  jpeg: Buffer;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Crop maths
// ---------------------------------------------------------------------------

/**
 * Square crop around a Gemini box ([ymin, xmin, ymax, xmax], normalized 0–1000),
 * enlarged by `pad` on each side so the avatar isn't a tight face crop, then clamped to
 * the image. Returns integer pixel coordinates for sharp.extract().
 */
export function squareCropRect(
  box: number[],
  imgW: number,
  imgH: number,
  pad = 0.25,
): { left: number; top: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = box.map(v => Math.min(1000, Math.max(0, v)));
  const x0 = (Math.min(xmin, xmax) / 1000) * imgW;
  const x1 = (Math.max(xmin, xmax) / 1000) * imgW;
  const y0 = (Math.min(ymin, ymax) / 1000) * imgH;
  const y1 = (Math.max(ymin, ymax) / 1000) * imgH;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let side = Math.max(x1 - x0, y1 - y0) * (1 + 2 * pad);
  side = Math.min(side, imgW, imgH);
  side = Math.max(1, Math.round(side));
  const left = Math.round(Math.min(Math.max(cx - side / 2, 0), imgW - side));
  const top = Math.round(Math.min(Math.max(cy - side / 2, 0), imgH - side));
  return { left, top, width: side, height: side };
}

// ---------------------------------------------------------------------------
// PDF image extraction
// ---------------------------------------------------------------------------

/** Reverses PNG row filters (PDF /Predictor ≥ 10). */
export function pngUnfilter(data: Buffer, width: number, channels: number, bpc = 8): Buffer {
  const bpp = Math.max(1, Math.ceil((channels * bpc) / 8));
  const rowLen = Math.ceil((width * channels * bpc) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = Buffer.alloc(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const filter = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[dst - rowLen + i] : 0;
      const c = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = raw;
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

function nameOf(obj: any): string | null {
  return obj instanceof PDFName ? obj.decodeText() : null;
}

function filtersOf(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map(nameOf).filter(Boolean) as string[];
  const n = nameOf(f);
  return n ? [n] : [];
}

function numberOf(dict: PDFDict, key: string, ctx: any): number | null {
  let v: any = dict.get(PDFName.of(key));
  if (v instanceof PDFRef) v = ctx.lookup(v);
  return v instanceof PDFNumber ? v.asNumber() : null;
}

/** Colour channels of an image's /ColorSpace (null = unsupported, e.g. Indexed). */
function channelsOf(dict: PDFDict, ctx: any): number | null {
  let cs: any = dict.get(PDFName.of('ColorSpace'));
  if (cs instanceof PDFRef) cs = ctx.lookup(cs);
  const simple = nameOf(cs);
  if (simple === 'DeviceRGB' || simple === 'CalRGB') return 3;
  if (simple === 'DeviceGray' || simple === 'CalGray') return 1;
  if (simple === 'DeviceCMYK') return 4;
  if (cs instanceof PDFArray) {
    const kind = nameOf(cs.get(0));
    if (kind === 'ICCBased') {
      let stream: any = cs.get(1);
      if (stream instanceof PDFRef) stream = ctx.lookup(stream);
      const n = stream?.dict ? numberOf(stream.dict, 'N', ctx) : null;
      return n === 1 || n === 3 || n === 4 ? n : null;
    }
    if (kind === 'CalRGB') return 3;
    if (kind === 'CalGray') return 1;
  }
  return null;
}

/** Every usable raster image embedded in a PDF, as encoded buffers sharp can read. */
export async function extractPdfImages(pdfBytes: Buffer | Uint8Array): Promise<Buffer[]> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const ctx = pdf.context;
  const objects = ctx.enumerateIndirectObjects();

  // Soft masks are images too, but only the alpha of another one — never a photo.
  const maskRefs = new Set<string>();
  for (const [, obj] of objects) {
    if (obj instanceof PDFRawStream) {
      const sm = obj.dict.get(PDFName.of('SMask'));
      if (sm instanceof PDFRef) maskRefs.add(sm.toString());
    }
  }

  const out: Buffer[] = [];
  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (nameOf(dict.get(PDFName.of('Subtype'))) !== 'Image') continue;
    if (maskRefs.has(ref.toString())) continue;
    const imageMask: any = dict.get(PDFName.of('ImageMask'));
    if (imageMask && imageMask.toString() === 'true') continue;

    const width = numberOf(dict, 'Width', ctx) || 0;
    const height = numberOf(dict, 'Height', ctx) || 0;
    if (Math.min(width, height) < MIN_SIDE || width * height > MAX_PIXELS) continue;

    const filters = filtersOf(dict);
    try {
      if (filters.length === 1 && filters[0] === 'DCTDecode') {
        // A JPEG stored as-is: the stream IS the .jpg file.
        out.push(Buffer.from(obj.contents));
      } else if (filters.length === 1 && filters[0] === 'FlateDecode') {
        const channels = channelsOf(dict, ctx);
        const bpc = numberOf(dict, 'BitsPerComponent', ctx) || 8;
        if (!channels || bpc !== 8) continue;
        let raw = zlib.inflateSync(Buffer.from(obj.contents));
        let parms: any = dict.get(PDFName.of('DecodeParms'));
        if (parms instanceof PDFRef) parms = ctx.lookup(parms);
        const predictor = parms instanceof PDFDict ? numberOf(parms, 'Predictor', ctx) : null;
        if (predictor && predictor >= 10) raw = pngUnfilter(raw, width, channels, bpc);
        if (raw.length < width * height * channels) continue;
        let img = sharp(raw.subarray(0, width * height * channels), { raw: { width, height, channels: channels as 1 | 3 | 4 } });
        if (channels === 4) img = img.removeAlpha(); // CMYK raw: rare in CVs; keep it simple
        out.push(await img.png().toBuffer());
      }
      // JPX (JPEG 2000), CCITT and multi-filter chains are skipped — not CV photos in practice.
    } catch (e: any) {
      console.warn('[cv-photo] imagen del PDF ilegible, se omite:', e?.message || e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Harvest: all candidate images of a CV, normalized
// ---------------------------------------------------------------------------

/** EXIF-rotated, flattened sRGB JPEG (≤1600px), or null if unreadable / not photo-shaped. */
export async function normalizeCvImage(buf: Buffer): Promise<CvImage | null> {
  try {
    const { data, info } = await sharp(buf, { limitInputPixels: MAX_PIXELS })
      .rotate() // honour EXIF orientation (phone photos of CVs)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    if (Math.min(info.width, info.height) < MIN_SIDE) return null;
    const ratio = info.width / info.height;
    if (ratio < 0.3 || ratio > 3.5) return null; // banners, lines, separators
    return { jpeg: data, width: info.width, height: info.height };
  } catch {
    return null; // EMF/WMF/SVG clip-art and other formats sharp can't read
  }
}

/** Every plausible picture inside the CV, largest first (at most MAX_CANDIDATES). */
export async function harvestCvImages(file: Buffer, mimeType: string): Promise<CvImage[]> {
  let raws: Buffer[] = [];
  const mt = (mimeType || '').toLowerCase();
  if (mt.startsWith('image/')) {
    raws = [file];
  } else if (mt.includes('pdf')) {
    raws = await extractPdfImages(file);
  } else if (mt.includes('wordprocessingml') || mt.includes('msword') || mt.includes('officedocument')) {
    try {
      const zip = await JSZip.loadAsync(file);
      const media = Object.values(zip.files).filter(f => !f.dir && /^word\/media\//i.test(f.name));
      raws = await Promise.all(media.map(f => f.async('nodebuffer')));
    } catch {
      raws = []; // legacy binary .doc: no zip, no images we can reach
    }
  }
  const images = (await Promise.all(raws.map(normalizeCvImage))).filter(Boolean) as CvImage[];
  // Exact duplicates (same image reused on several pages) only cost tokens.
  const seen = new Set<string>();
  const unique = images.filter(img => {
    const key = `${img.width}x${img.height}:${img.jpeg.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Gemini: which image is the portrait, and where is the face?
// ---------------------------------------------------------------------------

const locateSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    photo_index: { type: Type.INTEGER },
    box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER } },
  },
  required: ['photo_index'],
};

export async function locatePortrait(images: CvImage[]): Promise<{ index: number; box: number[] | null } | null> {
  if (images.length === 0) return null;
  const ai = getAI();
  if (!ai) throw new Error('Gemini no está configurado');

  const prompt = `
Recibes ${images.length} imagen(es) extraídas del currículum de un postulante, numeradas desde 0 en el orden en que aparecen.
Tarea: identifica la FOTO DE PERFIL del postulante — una fotografía real de una persona (retrato tipo carnet, selfie o foto de medio cuerpo).
NO cuentan: logotipos, íconos, ilustraciones, avatares dibujados, firmas, códigos QR, gráficos, fondos decorativos ni fotos de grupo.
Si una imagen es una página completa del CV (escaneo o foto del documento) que CONTIENE la foto de la persona, esa imagen también vale.

Responde JSON:
- photo_index: el número de la imagen con la foto de perfil, o -1 si ninguna tiene una foto real de una persona.
- box_2d: [ymin, xmin, ymax, xmax] normalizado de 0 a 1000 dentro de ESA imagen, encuadrando la cabeza completa de la persona (cabello, cara y barbilla). Omítelo si photo_index es -1.
`;
  const parts: any[] = [prompt];
  images.forEach((img, i) => {
    parts.push(`Imagen ${i}:`);
    parts.push({ inlineData: { data: img.jpeg.toString('base64'), mimeType: 'image/jpeg' } });
  });

  const response = await generateContentResilient(ai, {
    model: GEMINI_MODEL,
    contents: parts,
    config: { responseMimeType: 'application/json', responseSchema: locateSchema, temperature: 0 },
  }, { timeoutMs: 60_000 });

  const text = (response.text || '').replace(/```json\n?|```/g, '').trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  const index = Number(parsed.photo_index);
  if (!Number.isInteger(index) || index < 0 || index >= images.length) return null;
  const box = Array.isArray(parsed.box_2d) && parsed.box_2d.length === 4 && parsed.box_2d.every((n: any) => Number.isFinite(Number(n)))
    ? parsed.box_2d.map(Number)
    : null;
  return { index, box };
}

// ---------------------------------------------------------------------------
// Avatar rendering
// ---------------------------------------------------------------------------

/**
 * Square 400×400 JPEG from an already-normalized image (see normalizeCvImage). With a
 * face box: centered on the face; without one: sharp's "attention" smart crop.
 */
export async function renderAvatar(image: Buffer, box: number[] | null): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  let pipeline = sharp(image);
  if (box && width > 0 && height > 0) {
    const rect = squareCropRect(box, width, height);
    if (rect.width >= 24) pipeline = pipeline.extract(rect);
  }
  return pipeline
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

/**
 * The whole pipeline. Returns the avatar JPEG, or null when the CV has no photo of the
 * person. Throws only on infrastructure errors (Gemini down, unreadable file).
 */
export async function findCvPhoto(file: Buffer, mimeType: string): Promise<Buffer | null> {
  const images = await harvestCvImages(file, mimeType);
  if (images.length === 0) return null;
  const found = await locatePortrait(images);
  if (!found) return null;
  return renderAvatar(images[found.index].jpeg, found.box);
}

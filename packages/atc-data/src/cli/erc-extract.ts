/**
 * Extracts the vector layers of EUROCONTROL ERC GeoPDFs (charts/erc*.pdf) into
 * db/erc/<sheet>.json: paths and texts per optional-content layer, in page
 * coordinates, with the page's georeference. The pack builder turns them into
 * sectors, points and routes (importers/erc.ts).
 *
 *   pnpm data:erc                       every charts/erc*.pdf
 *   pnpm data:erc charts/erc06h-11jun2026.pdf
 *
 * The charts are © EUROCONTROL ("no part may be reproduced … without written
 * permission"): extracts stay in db/ and packs built from them are devOnly.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ErcSheet, ErcPath, ErcText } from '../importers/erc';
import { ERC_LAYERS } from '../importers/erc';
import type { GeoPdfViewport } from '../importers/geopdf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** pdf.js path drawing codes inside constructPath data. */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

/** The page viewport's georeference, read from the raw file (pdf.js does not expose /VP). */
function readViewport(raw: string): GeoPdfViewport {
  const nums = (key: string, from = 0) => {
    const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(raw.slice(from));
    if (!m) throw new Error(`no /${key} (not a GeoPDF?)`);
    return m[1]!.trim().split(/\s+/).map(Number);
  };
  const vp = raw.indexOf('/Viewport');
  if (vp < 0) throw new Error('no /Viewport (not a GeoPDF?)');
  // The viewport's /BBox is in the same dictionary, before or after /Type.
  const start = raw.lastIndexOf('<<', vp);
  const wkt = /\/WKT\s*\(((?:[^()\\]|\\.|\([^()]*\))*)\)/.exec(raw)?.[1];
  if (!wkt) throw new Error('no /WKT');
  return { bbox: nums('BBox', start), gpts: nums('GPTS'), lpts: nums('LPTS'), wkt };
}

/** Innermost named layer of a marked-content stack. */
const innermost = (stack: string[]) => [...stack].reverse().find((s) => s !== '') ?? '';

/** "erc06h-11jun2026" → sheet "erc06h", edition "2026-06-11". */
function sheetName(file: string): { sheet: string; edition: string } {
  const base = path.basename(file, '.pdf');
  const m = /^(erc\d{2}[hl])-(\d{1,2})([a-z]{3})(\d{4})$/i.exec(base);
  if (!m) throw new Error(`${base}: expected erc<NN><h|l>-<DDmonYYYY>.pdf`);
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[3]!.toLowerCase()) + 1;
  return { sheet: m[1]!.toLowerCase(), edition: `${m[4]}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}` };
}

async function extract(file: string): Promise<ErcSheet> {
  const raw = readFileSync(file, 'latin1');
  const viewport = readViewport(raw);
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const oc = await doc.getOptionalContentConfig();
  const ocName = new Map<string, string>();
  for (const [id, group] of oc) ocName.set(id, group.name ?? '');
  const wanted = new Set<string>(ERC_LAYERS);

  // ── Paths: constructPath inside marked-content layers (page space; the only
  // transform in ERC sheets is the logo image).
  const ops = await page.getOperatorList();
  const layerOfMarker: string[] = []; // layer name per begin-marker, in stream order
  const stack: string[] = [];
  const paths: ErcPath[] = [];
  const layerNow = () => innermost(stack);
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.beginMarkedContentProps || fn === OPS.beginMarkedContent) {
      const props = fn === OPS.beginMarkedContentProps ? args[1] : null;
      const name = props && typeof props === 'object' && props.type === 'OCG' ? (ocName.get(props.id) ?? '') : '';
      stack.push(name);
      layerOfMarker.push(name);
    } else if (fn === OPS.endMarkedContent) {
      stack.pop();
    } else if (fn === OPS.constructPath) {
      const layer = layerNow();
      if (!wanted.has(layer) || args[0] === OPS.endPath) continue; // clip-only paths draw nothing
      const data = args[1][0] as Float32Array | number[];
      let cur: number[] = [];
      let closed = false;
      const flush = () => {
        if (cur.length >= 4) paths.push({ layer, closed, pts: cur.map((v) => Math.round(v * 100) / 100) });
        cur = [];
        closed = false;
      };
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === DRAW.moveTo) {
          flush();
          cur.push(data[k++]!, data[k++]!);
        } else if (op === DRAW.lineTo) {
          cur.push(data[k++]!, data[k++]!);
        } else if (op === DRAW.curveTo) {
          k += 4;
          cur.push(data[k++]!, data[k++]!);
        } else if (op === DRAW.quadraticCurveTo) {
          k += 2;
          cur.push(data[k++]!, data[k++]!);
        } else if (op === DRAW.closePath) {
          closed = true;
        } else {
          throw new Error(`${path.basename(file)}: unknown path code ${op}`);
        }
      }
      flush();
    }
  }

  // ── Texts: the text content repeats the marked-content markers in the same
  // order (without ids), so layers come from the operator list by position.
  const tc = await page.getTextContent({ includeMarkedContent: true });
  const texts: ErcText[] = [];
  const tstack: string[] = [];
  let marker = 0;
  for (const item of tc.items as Array<{ type?: string; str?: string; transform?: number[]; width?: number; height?: number }>) {
    if (item.type === 'beginMarkedContentProps' || item.type === 'beginMarkedContent') {
      tstack.push(layerOfMarker[marker++] ?? '');
    } else if (item.type === 'endMarkedContent') {
      tstack.pop();
    } else if (item.str?.trim() && item.transform) {
      const layer = innermost(tstack);
      if (!wanted.has(layer)) continue;
      const [a, b, , , e, f] = item.transform as [number, number, number, number, number, number];
      texts.push({
        layer,
        str: item.str,
        x: Math.round(e * 100) / 100,
        y: Math.round(f * 100) / 100,
        w: Math.round((item.width ?? 0) * 100) / 100,
        size: Math.round(Math.hypot(a, b) * 100) / 100,
        angle: Math.round((Math.atan2(b, a) * 180) / Math.PI * 10) / 10,
      });
    }
  }
  if (marker !== layerOfMarker.length) throw new Error(`${path.basename(file)}: marked-content mismatch (${marker} ≠ ${layerOfMarker.length})`);

  return { ...sheetName(file), file: path.basename(file), viewport, paths, texts };
}

const args = process.argv.slice(2);
const chartsDir = path.join(ROOT, 'charts');
const files = args.length
  ? args.map((f) => path.resolve(process.env.INIT_CWD ?? ROOT, f))
  : readdirSync(chartsDir).filter((f) => /^erc\d{2}[hl]-.*\.pdf$/i.test(f)).map((f) => path.join(chartsDir, f));
if (!files.length) throw new Error('no charts/erc*.pdf — download ERC GeoPDFs from https://www.eurocontrol.int/service/cartography');
const out = path.join(ROOT, 'db', 'erc');
mkdirSync(out, { recursive: true });
for (const f of files) {
  const t0 = Date.now();
  const s = await extract(f);
  writeFileSync(path.join(out, `${s.sheet}.json`), JSON.stringify(s));
  console.log(`${s.file}: ${s.paths.length} paths, ${s.texts.length} texts (${(Date.now() - t0) / 1000}s) → db/erc/${s.sheet}.json`);
}

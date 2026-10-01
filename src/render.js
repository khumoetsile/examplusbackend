// Server-side page rendering with Ghostscript (present on most cPanel hosts).
// Learners then receive page IMAGES, never the PDF file, and odd PDFs that browsers' JS renderers cannot
// read still display correctly. When Ghostscript is missing everything falls back to the PDF-based path.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const root = path.join(__dirname, '..', 'storage');
const papersDir = path.join(root, 'papers');
const pagesDir = path.join(root, 'pages');
const GS = process.env.GS_PATH || 'gs';
const DPI = Number(process.env.PAGE_DPI) || 110;

let gsOk = null;
const hasGs = () => gsOk !== null ? Promise.resolve(gsOk) : new Promise((resolve) => {
  execFile(GS, ['--version'], { timeout: 5000 }, (err) => { gsOk = !err; resolve(gsOk); });
});

// Run at most 2 Ghostscript jobs at once so a shared host is not overloaded.
let running = 0; const waiting = [];
const slot = () => new Promise((res) => { if (running < 2) { running++; res(); } else waiting.push(res); });
const release = () => { const n = waiting.shift(); if (n) n(); else running--; };
const inflight = new Map(); // de-duplicate concurrent renders of the same page

const baseOf = (fileName) => path.basename(fileName, '.pdf');
const dirOf = (fileName) => path.join(pagesDir, baseOf(fileName));

async function pageCount(fileName) {
  const dir = dirOf(fileName), meta = path.join(dir, 'meta.json');
  try { return JSON.parse(fs.readFileSync(meta, 'utf8')).count; } catch { /* not cached yet */ }
  const doc = await PDFDocument.load(fs.readFileSync(path.join(papersDir, path.basename(fileName))), { ignoreEncryption: true, updateMetadata: false });
  const count = doc.getPageCount();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(meta, JSON.stringify({ count }));
  return count;
}

// Returns the path of a JPEG of page n (1-based), rendering and caching it on first use.
async function pageImage(fileName, n) {
  const out = path.join(dirOf(fileName), `${n}.jpg`);
  if (fs.existsSync(out)) return out;
  if (inflight.has(out)) return inflight.get(out);
  const job = (async () => {
    await slot();
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = `${out}.${process.pid}.tmp`;
      await new Promise((resolve, reject) => execFile(GS, [
        '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dNOINTERPOLATE', `-dFirstPage=${n}`, `-dLastPage=${n}`,
        '-sDEVICE=jpeg', '-dJPEGQ=78', `-r${DPI}`, '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
        `-sOutputFile=${tmp}`, path.join(papersDir, path.basename(fileName)),
      ], { timeout: 90000 }, (err) => (err && !fs.existsSync(tmp) ? reject(err) : resolve())));
      fs.renameSync(tmp, out);
      return out;
    } finally { release(); inflight.delete(out); }
  })();
  inflight.set(out, job);
  return job;
}

const removePages = (fileName) => fs.rm(dirOf(fileName), { recursive: true, force: true }, () => {});

module.exports = { hasGs, pageCount, pageImage, removePages };

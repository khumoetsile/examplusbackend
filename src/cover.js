const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const papersDir = path.join(__dirname, '..', 'storage', 'papers');
const coversDir = path.join(__dirname, '..', 'storage', 'covers');

// Returns the path of a one-page PDF holding only the first page (the cover) of a paper.
// Built once and cached on disk; the cache is keyed by the stored file name, so replacing a PDF refreshes it.
async function coverFor(fileName) {
  const base = path.basename(fileName, '.pdf');
  const out = path.join(coversDir, `${base}.pdf`);
  if (fs.existsSync(out)) return out;
  const src = path.join(papersDir, path.basename(fileName));
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(coversDir, { recursive: true });
  const doc = await PDFDocument.load(fs.readFileSync(src), { ignoreEncryption: true });
  const cover = await PDFDocument.create();
  const [page] = await cover.copyPages(doc, [0]);
  cover.addPage(page);
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, await cover.save());
  fs.renameSync(tmp, out);
  return out;
}

const removeCover = (fileName) => fs.rm(path.join(coversDir, `${path.basename(fileName, '.pdf')}.pdf`), { force: true }, () => {});

module.exports = { coverFor, removeCover };

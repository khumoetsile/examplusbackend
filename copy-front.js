// Copies the Angular production build into backend/public (served by app.js).
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'frontend', 'dist', 'frontend', 'browser');
const dst = path.join(__dirname, 'public');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Frontend copied to', dst);

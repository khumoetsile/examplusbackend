require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { optionalAuth } = require('./src/auth');

const app = express();
app.set('trust proxy', 1); // cPanel/Passenger sits behind a proxy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      workerSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(optionalAuth);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', limiter);
app.use('/api/auth/register', limiter);

app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/public'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Serve the built Angular app (copied to ./public by `npm run build:front`).
const pub = path.join(__dirname, 'public');
if (fs.existsSync(pub)) {
  app.use(express.static(pub, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(pub, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That record already exists.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 60MB).' });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Exam portal listening on ${port}`));

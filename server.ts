import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.ts';
import { getDb } from './server/db/database.ts';
import { env } from './server/config/env.ts';

async function startServer() {
  // Initialize SQLite database schema on startup
  getDb();

  const app = createApp();
  const isProd = env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`RequirementRipple server listening on http://0.0.0.0:${env.PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RequirementRipple server:', err);
  process.exit(1);
});

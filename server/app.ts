import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/authRoutes.ts';
import { orgRouter } from './routes/orgRoutes.ts';
import { projectRouter } from './routes/projectRoutes.ts';
import { requirementRouter } from './routes/requirementRoutes.ts';
import { dependencyRouter } from './routes/dependencyRoutes.ts';
import { changeAndIntelRouter } from './routes/changeAndIntelRoutes.ts';
import { errorHandler } from './middleware/authMiddleware.ts';
import { env } from './config/env.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') || origin === env.APP_URL) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'RequirementRipple', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/orgs', orgRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/projects/:projectId/requirements', requirementRouter);
  app.use('/api/projects/:projectId', dependencyRouter);
  app.use('/api/projects/:projectId', changeAndIntelRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(errorHandler);
  return app;
}

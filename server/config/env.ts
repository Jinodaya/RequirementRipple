import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const fallbackJwtSecret = crypto.randomBytes(32).toString('hex');
const fallbackRefreshSecret = crypto.randomBytes(32).toString('hex');

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  JWT_SECRET: process.env.JWT_SECRET || fallbackJwtSecret,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || fallbackRefreshSecret,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  DB_PATH: process.env.DB_PATH || './data/requirementripple.db',
};

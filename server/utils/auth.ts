import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { CookieOptions, Response, Request } from 'express';
import { env } from '../config/env.ts';

export type OrgRole =
  | 'Organization Owner'
  | 'Administrator'
  | 'Project Manager'
  | 'Developer'
  | 'Tester'
  | 'Viewer';

export const ALL_ROLES: OrgRole[] = [
  'Organization Owner',
  'Administrator',
  'Project Manager',
  'Developer',
  'Tester',
  'Viewer',
];

export type Permission =
  | 'org:manage'
  | 'team:invite'
  | 'team:manage_roles'
  | 'project:create'
  | 'project:edit'
  | 'project:delete'
  | 'requirement:write'
  | 'requirement:approve'
  | 'dependency:write'
  | 'repository:connect'
  | 'change:submit'
  | 'change:approve'
  | 'scenario:simulate'
  | 'test:write'
  | 'test:execute'
  | 'history:write'
  | 'read';

const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  'Organization Owner': [
    'org:manage',
    'team:invite',
    'team:manage_roles',
    'project:create',
    'project:edit',
    'project:delete',
    'requirement:write',
    'requirement:approve',
    'dependency:write',
    'repository:connect',
    'change:submit',
    'change:approve',
    'scenario:simulate',
    'test:write',
    'test:execute',
    'history:write',
    'read',
  ],
  Administrator: [
    'org:manage',
    'team:invite',
    'team:manage_roles',
    'project:create',
    'project:edit',
    'project:delete',
    'requirement:write',
    'requirement:approve',
    'dependency:write',
    'repository:connect',
    'change:submit',
    'change:approve',
    'scenario:simulate',
    'test:write',
    'test:execute',
    'history:write',
    'read',
  ],
  'Project Manager': [
    'team:invite',
    'project:create',
    'project:edit',
    'requirement:write',
    'requirement:approve',
    'dependency:write',
    'change:submit',
    'change:approve',
    'scenario:simulate',
    'test:write',
    'history:write',
    'read',
  ],
  Developer: [
    'requirement:write',
    'dependency:write',
    'repository:connect',
    'change:submit',
    'scenario:simulate',
    'test:write',
    'test:execute',
    'history:write',
    'read',
  ],
  Tester: [
    'change:submit',
    'scenario:simulate',
    'test:write',
    'test:execute',
    'history:write',
    'read',
  ],
  Viewer: ['read'],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as OrgRole];
  if (!perms) return false;
  return perms.includes(permission);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '2h' });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setRefreshCookie(res: Response, rawToken: string): void {
  res.cookie('rr_refresh', rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/auth',
    maxAge: 14 * 24 * 60 * 60 * 1000,
    partitioned: true,
  } as CookieOptions);
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie('rr_refresh', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/auth',
    partitioned: true,
  } as CookieOptions);
}

export function verifyRequestOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  try {
    const parsedOrigin = new URL(origin);
    const expectedHost = Array.isArray(host) ? host[0] : host;
    return parsedOrigin.host === expectedHost;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const key = crypto.createHash('sha256').update(env.JWT_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return '';
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const key = crypto.createHash('sha256').update(env.JWT_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

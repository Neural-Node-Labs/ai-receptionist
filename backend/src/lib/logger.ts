import winston from 'winston';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const isProd = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    isProd ? json() : combine(colorize(), simple())
  ),
  transports: [new winston.transports.Console()],
  silent: process.env.NODE_ENV === 'test',
});

export function sanitizeForLog(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  const sensitive = ['apiKey', 'api_key', 'password', 'token', 'secret', 'authorization'];
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      k,
      sensitive.some((s) => k.toLowerCase().includes(s)) ? '[REDACTED]' : v,
    ])
  );
}

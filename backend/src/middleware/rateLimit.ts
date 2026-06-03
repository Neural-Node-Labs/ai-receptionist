import { RateLimiterMemory } from 'rate-limiter-flexible';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

const rateLimiter = new RateLimiterMemory({
  points: parseInt(process.env.RATE_LIMIT_POINTS || '30', 10),
  duration: parseInt(process.env.RATE_LIMIT_DURATION || '60', 10),
  blockDuration: 120,
});

export async function withRateLimit(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  try {
    await rateLimiter.consume(ip);
    return await handler();
  } catch {
    logger.warn({ msg: 'Rate limit exceeded', ip });
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' },
      {
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Limit': process.env.RATE_LIMIT_POINTS || '30',
        },
      }
    );
  }
}

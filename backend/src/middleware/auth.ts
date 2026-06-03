import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export function withApiAuth(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const apiKey = req.headers.get('x-api-key');
  const secret = process.env.API_SECRET_KEY;

  if (!secret) {
    logger.error('API_SECRET_KEY not configured');
    return Promise.resolve(
      NextResponse.json({ error: 'Server misconfiguration', code: 'CONFIG_ERROR' }, { status: 500 })
    );
  }

  if (!apiKey || apiKey !== secret) {
    logger.warn({ msg: 'Unauthorized API access attempt' });
    return Promise.resolve(
      NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    );
  }

  return handler();
}

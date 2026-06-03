import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/middleware/rateLimit';
import { withApiAuth } from '@/middleware/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withRateLimit(req, () =>
    withApiAuth(req, async () => {
      const defaultProvider = process.env.DEFAULT_LLM_PROVIDER || 'deepseek';
      return NextResponse.json({
        providers: [
          {
            id: 'deepseek',
            label: 'DeepSeek',
            model: 'deepseek-chat',
            available: !!process.env.DEEPSEEK_API_KEY,
            isDefault: defaultProvider === 'deepseek',
          },
          {
            id: 'anthropic',
            label: 'Anthropic (Claude Haiku)',
            model: 'claude-haiku-4-5-20251001',
            available: !!process.env.ANTHROPIC_API_KEY,
            isDefault: defaultProvider === 'anthropic',
          },
          {
            id: 'openai',
            label: 'OpenAI',
            model: 'gpt-4o-mini',
            available: !!process.env.OPENAI_API_KEY,
            isDefault: defaultProvider === 'openai',
          },
        ],
        default: defaultProvider,
      });
    })
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 });
}

import { NextRequest, NextResponse } from 'next/server';
import { getKnowledgeStats } from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startTime = Date.now();

// Health is intentionally public (no auth) so load balancers / Docker healthchecks work
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const stats = await getKnowledgeStats().catch(() => null);

  return NextResponse.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    vectorDb: stats !== null,
    knowledgeChunks: stats?.totalChunks ?? 0,
    sources: stats?.sources ?? [],
    timestamp: new Date().toISOString(),
    providers: {
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
    defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'deepseek',
  });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 });
}

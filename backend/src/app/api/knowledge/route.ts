import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/middleware/rateLimit';
import { withApiAuth } from '@/middleware/auth';
import { validateBody, IngestRequestSchema } from '@/lib/validation';
import { ingestDocument, getKnowledgeStats } from '@/lib/rag';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withRateLimit(req, () =>
    withApiAuth(req, async () => {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
      }

      const validation = validateBody(IngestRequestSchema, body);
      if (!validation.success) {
        return NextResponse.json({ error: validation.error, code: 'VALIDATION_ERROR' }, { status: 422 });
      }

      const { content, source, metadata } = validation.data;

      try {
        const chunksCreated = await ingestDocument(content, source, metadata);
        logger.info({ msg: 'Knowledge ingested via API', source, chunksCreated });
        return NextResponse.json({ success: true, chunksCreated, source });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ msg: 'Ingest error', source, err: message });
        return NextResponse.json({ error: 'Ingestion failed', code: 'INGEST_ERROR' }, { status: 500 });
      }
    })
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withApiAuth(req, async () => {
    const stats = await getKnowledgeStats();
    return NextResponse.json(stats);
  });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 });
}

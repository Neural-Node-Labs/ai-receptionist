import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/middleware/rateLimit';
import { withApiAuth } from '@/middleware/auth';
import { validateBody, ChatRequestSchema } from '@/lib/validation';
import { callLLM, getDefaultProvider } from '@/lib/llm';
import { retrieveContext } from '@/lib/rag';
import { buildSystemPrompt } from '@/lib/prompt';
import { logger } from '@/lib/logger';
import { LLMProvider } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withRateLimit(req, () =>
    withApiAuth(req, async () => {
      const start = Date.now();

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
          { status: 400 }
        );
      }

      const validation = validateBody(ChatRequestSchema, body);
      if (!validation.success) {
        return NextResponse.json(
          { error: validation.error, code: 'VALIDATION_ERROR' },
          { status: 422 }
        );
      }

      const { messages, provider, sessionId } = validation.data;
      const resolvedProvider: LLMProvider = (provider as LLMProvider | undefined) ?? getDefaultProvider();

      // Last user message used for RAG retrieval
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      const ragQuery = lastUserMsg?.content ?? '';

      try {
        const ragResult = await retrieveContext(ragQuery);
        const systemPrompt = buildSystemPrompt(ragResult.contextText);
        const llmResponse = await callLLM(resolvedProvider, messages, systemPrompt);

        logger.info({
          msg: 'Chat request handled',
          sessionId,
          provider: resolvedProvider,
          contextChunks: ragResult.chunks.length,
          tokensUsed: llmResponse.tokensUsed,
          latencyMs: Date.now() - start,
        });

        return NextResponse.json({
          reply: llmResponse.content,
          provider: resolvedProvider,
          model: llmResponse.model,
          tokensUsed: llmResponse.tokensUsed,
          contextChunks: ragResult.chunks.length,
          latencyMs: Date.now() - start,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'LLM call failed';
        logger.error({ msg: 'Chat error', sessionId, provider: resolvedProvider, error: message });
        return NextResponse.json(
          { error: message, code: 'LLM_ERROR' },
          { status: 502 }
        );
      }
    })
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 });
}

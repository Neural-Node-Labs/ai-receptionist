import { z } from 'zod';

const PROVIDER_VALUES = ['deepseek', 'anthropic', 'openai'] as const;

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z
    .string()
    .min(1, 'Message content cannot be empty')
    .max(4096, 'Message too long (max 4096 chars)'),
});

export const ChatRequestSchema = z.object({
  messages: z
    .array(MessageSchema)
    .min(1, 'At least one message required')
    .max(20, 'Too many messages in context (max 20)'),
  provider: z.enum(PROVIDER_VALUES).optional(),
  sessionId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid session ID format'),
  stream: z.boolean().optional().default(false),
});

export const IngestRequestSchema = z.object({
  content: z
    .string()
    .min(10, 'Content too short (min 10 chars)')
    .max(100_000, 'Content too large (max 100KB)'),
  source: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[a-zA-Z0-9 _\-.\/]+$/, 'Invalid source name'),
  metadata: z
    .record(z.string().max(512))
    .optional()
    .default({}),
});

export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type IngestRequestInput = z.infer<typeof IngestRequestSchema>;

export function validateBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  const message = result.error.errors
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .join('; ');
  return { success: false, error: message };
}

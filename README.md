# AI Receptionist

Production-grade AI receptionist with RAG (Retrieval-Augmented Generation), CBD architecture, multi-LLM provider support, and full Docker deployment.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Network                           │
│                                                                 │
│  ┌──────────────────┐        ┌──────────────────────────────┐  │
│  │   Frontend (UI)  │  HTTP  │      Backend API             │  │
│  │  Next.js :3000   │───────▶│      Next.js :3001           │  │
│  │  React/TypeScript│        │      TypeScript              │  │
│  └──────────────────┘        │                              │  │
│                              │  ┌─────────┐  ┌──────────┐  │  │
│                              │  │   RAG   │  │   LLM    │  │  │
│                              │  │ Engine  │  │ Router   │  │  │
│                              │  │HNSWlib  │  │          │  │  │
│                              │  │MiniLM   │  │DeepSeek  │  │  │
│                              │  │ Embed   │  │Anthropic │  │  │
│                              │  └────┬────┘  │OpenAI    │  │  │
│                              │       │        └──────────┘  │  │
│                              └───────┼──────────────────────┘  │
│                                      │                          │
│                              ┌───────▼────────┐                │
│                              │ Vector DB Vol. │                │
│                              │ HNSWlib index  │                │
│                              │ Persisted JSON │                │
│                              └────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

### CBD (Component-Based Design) Layers

| Layer | Component | Responsibility |
|-------|-----------|---------------|
| API | Next.js Route Handlers | HTTP, auth, rate limiting, validation |
| RAG | `lib/rag.ts` | Chunking, embedding, vector search, context budget |
| LLM | `lib/llm.ts` | Provider abstraction, schema adapters |
| Prompt | `lib/prompt.ts` | Token-efficient system prompt injection |
| Security | Middleware | Auth, rate limiting, CORS, CSP headers |

---

## Features

- **RAG Pipeline**: Document ingestion → chunking → local embeddings (MiniLM-L6-v2) → HNSWlib vector DB → similarity search → token-budget context assembly
- **Multi-LLM**: Switch between DeepSeek (default), Anthropic Claude, OpenAI GPT with unified abstraction
- **Token Minimization**: Context budget capped at ~1800 tokens, similarity threshold filtering, compact system prompts
- **Security**: API key auth, rate limiting (per-IP), input validation (Zod), security headers (CSP, HSTS, etc.), non-root Docker user
- **Persistence**: Vector index + metadata persisted to Docker volume
- **Console UI**: Terminal-aesthetic React UI with provider switching, KB management, session stats

---

## Quick Start

### Prerequisites
- Docker + Docker Compose (v2)
- At least one LLM API key

### 1. Clone and configure
```bash
git clone <repo>
cd ai-receptionist
cp .env.example .env
# Edit .env — set API keys and API_SECRET_KEY
```

### 2. Run setup (builds, starts, validates)
```bash
chmod +x setup.sh
./setup.sh
```

### 3. Or manually
```bash
docker compose up --build -d
```

### 4. Open UI
```
http://localhost:3000
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | One of three | — | DeepSeek API key |
| `ANTHROPIC_API_KEY` | One of three | — | Anthropic API key |
| `OPENAI_API_KEY` | One of three | — | OpenAI API key |
| `DEFAULT_LLM_PROVIDER` | No | `deepseek` | Default provider |
| `API_SECRET_KEY` | **Yes** | — | Shared secret for UI↔API auth |
| `FRONTEND_URL` | No | `http://localhost:3000` | CORS allowed origin |
| `RATE_LIMIT_POINTS` | No | `30` | Requests per window |
| `RATE_LIMIT_DURATION` | No | `60` | Rate limit window (seconds) |

---

## API Reference

All API routes require `x-api-key: <API_SECRET_KEY>` header.

### `POST /api/chat`
Send a message and receive an AI response with RAG context.

```json
{
  "messages": [{"role": "user", "content": "What are your hours?"}],
  "sessionId": "uuid-here",
  "provider": "deepseek"
}
```

Response:
```json
{
  "reply": "Our business hours are...",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "tokensUsed": 342,
  "contextChunks": 2,
  "latencyMs": 1240
}
```

### `POST /api/knowledge`
Ingest a document into the vector database.

```json
{
  "content": "Our company was founded in 2010...",
  "source": "company-overview",
  "metadata": {"department": "marketing"}
}
```

### `GET /api/knowledge`
Get knowledge base statistics.

### `GET /api/health`
System health check (no auth required).

### `GET /api/providers`
List available LLM providers and their status.

---

## RAG Pipeline Detail

```
Input text
    │
    ▼
Chunking (400 words, 80 word overlap)
    │
    ▼
Embeddings (Xenova/all-MiniLM-L6-v2, local, 384-dim)
    │
    ▼
HNSWlib Vector Index (cosine similarity, persisted to disk)
    │
    ▼ Query time
User message → embed → top-K search (k=5)
    │
    ▼
Filter (score > 0.25) + Token budget (≤1800 tokens)
    │
    ▼
System prompt injection → LLM call
```

---

## Security Checklist

- [x] All API routes require `x-api-key` header
- [x] Rate limiting per IP (in-memory, configurable)
- [x] Input validation with Zod schemas
- [x] Security headers: CSP, X-Frame-Options, X-XSS-Protection, Referrer-Policy
- [x] CORS restricted to `FRONTEND_URL`
- [x] Non-root user in Docker containers
- [x] API keys never logged (redacted in logs)
- [x] No sensitive data in frontend bundle
- [x] Request timeout (30s) on all LLM calls
- [x] Content length limits on all inputs

---

## Development

```bash
# Install deps
cd backend && npm install
cd ../frontend && npm install

# Run locally (requires .env files in each directory)
cd backend && npm run dev   # :3001
cd frontend && npm run dev  # :3000
```

---

## Docker Commands

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop
docker compose down

# Stop and remove volumes
docker compose down -v

# Rebuild after code changes
docker compose up --build -d
```

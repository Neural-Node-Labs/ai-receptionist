# ── Stage 1: Build dependencies ───────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Build tools for native extensions (hnswlib C++, bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    libffi-dev \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip --no-cache-dir \
 && pip install --prefix=/install --no-cache-dir -r requirements.txt

# ── Stage 2: Production runtime ───────────────────────────────────────────
FROM python:3.11-slim AS runner

WORKDIR /app

# Minimal runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 appgroup \
 && useradd  --system --uid 1001 --gid appgroup --no-create-home appuser

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Data directories (vector DB, model cache, users store)
RUN mkdir -p /app/data/vectordb /app/data/models /app/data/knowledge \
 && chown -R appuser:appgroup /app/data

# Application source
COPY --chown=appuser:appgroup app/ ./app/

# Environment defaults (docker-compose overrides at runtime)
ENV SENTENCE_TRANSFORMERS_HOME=/app/data/models
ENV HF_HOME=/app/data/models
ENV TRANSFORMERS_CACHE=/app/data/models
ENV PORT=3001
ENV ENV=production
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

USER appuser

EXPOSE 3001

# Simple HTTP check — no shell quoting issues
HEALTHCHECK --interval=20s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -sf http://localhost:3001/api/health || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "3001", \
     "--workers", "1", \
     "--no-access-log", \
     "--timeout-keep-alive", "30"]

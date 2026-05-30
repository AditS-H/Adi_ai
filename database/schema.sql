-- ═══════════════════════════════════════════════════
-- AditAI Database Schema
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- Enable pgvector extension
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- documents — Vectorized content chunks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content       TEXT NOT NULL,
  source_type   VARCHAR(50) NOT NULL,
  source_id     VARCHAR(255) NOT NULL,
  source_url    TEXT,
  chunk_index   INTEGER NOT NULL,
  total_chunks  INTEGER NOT NULL,
  metadata      JSONB DEFAULT '{}',
  embedding     VECTOR(768),
  content_hash  VARCHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- github_repos — Tracked repository metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS github_repos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_name     VARCHAR(255) NOT NULL UNIQUE,
  full_name     VARCHAR(255) NOT NULL,
  description   TEXT,
  html_url      TEXT,
  language      VARCHAR(100),
  languages     JSONB,
  topics        TEXT[],
  stars         INTEGER DEFAULT 0,
  forks         INTEGER DEFAULT 0,
  readme_hash   VARCHAR(64),
  last_scraped  TIMESTAMPTZ,
  last_commit   TIMESTAMPTZ,
  is_fork       BOOLEAN DEFAULT FALSE,
  is_private    BOOLEAN DEFAULT FALSE,
  is_indexed    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- chat_sessions — Visitor conversation history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    VARCHAR(255) NOT NULL UNIQUE,
  messages      JSONB DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  last_active   TIMESTAMPTZ DEFAULT NOW(),
  ip_address    VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- analytics — Query metrics and provider usage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question      TEXT NOT NULL,
  answer_length INTEGER,
  provider_used VARCHAR(50),
  was_cached    BOOLEAN DEFAULT FALSE,
  rag_chunks    INTEGER,
  response_time INTEGER,
  session_id    VARCHAR(255),
  ip_hash       VARCHAR(64),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- provider_health — Real-time provider status tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_health (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name         VARCHAR(50) NOT NULL UNIQUE,
  health_score          INTEGER DEFAULT 100,
  consecutive_failures  INTEGER DEFAULT 0,
  last_error            TEXT,
  last_error_code       VARCHAR(20),
  last_success          TIMESTAMPTZ,
  last_failure          TIMESTAMPTZ,
  cooldown_until        TIMESTAMPTZ,
  total_requests        INTEGER DEFAULT 0,
  total_failures        INTEGER DEFAULT 0,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- admin_tokens — Admin authentication tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    VARCHAR(64) NOT NULL UNIQUE,
  name          VARCHAR(100),
  last_used     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT TRUE
);

-- ═══════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════

-- B-tree indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents (source_type);
CREATE INDEX IF NOT EXISTS idx_documents_source_id   ON documents (source_id);
CREATE INDEX IF NOT EXISTS idx_documents_is_active   ON documents (is_active);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at   ON analytics (created_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_session  ON chat_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_github_repos_name      ON github_repos (repo_name);

-- IVFFlat index for fast cosine-similarity vector search
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- GIN index for full-text search on document content
CREATE INDEX IF NOT EXISTS idx_documents_fts
  ON documents
  USING gin (to_tsvector('english', content));

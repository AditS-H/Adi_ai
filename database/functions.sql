-- ═══════════════════════════════════════════════════
-- AditAI Database Functions
-- Run this AFTER schema.sql in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- match_documents — Cosine similarity search over document embeddings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5,
  filter_source_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  source_type TEXT,
  source_id VARCHAR,
  source_url TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.source_type,
    d.source_id,
    d.source_url,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE
    d.is_active = TRUE
    AND d.embedding IS NOT NULL
    AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

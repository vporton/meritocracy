-- Provider-neutral, compact AI outcomes.  No provider response metadata or raw
-- response body is retained in these tables.
CREATE TABLE "ai_results" (
    "id" SERIAL NOT NULL,
    "customId" TEXT NOT NULL,
    "taskId" INTEGER,
    "resultKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "errorMessage" TEXT,
    "requestInitiated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseReceived" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_result_sources" (
    "id" SERIAL NOT NULL,
    "aiResultId" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    CONSTRAINT "ai_result_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_results_customId_key" ON "ai_results"("customId");
CREATE INDEX "ai_results_taskId_idx" ON "ai_results"("taskId");
CREATE INDEX "ai_results_resultKind_idx" ON "ai_results"("resultKind");
CREATE UNIQUE INDEX "ai_result_sources_aiResultId_ordinal_key" ON "ai_result_sources"("aiResultId", "ordinal");
CREATE UNIQUE INDEX "ai_result_sources_aiResultId_url_key" ON "ai_result_sources"("aiResultId", "url");
ALTER TABLE "ai_results" ADD CONSTRAINT "ai_results_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_result_sources" ADD CONSTRAINT "ai_result_sources_aiResultId_fkey"
  FOREIGN KEY ("aiResultId") REFERENCES "ai_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Successful values are removed from legacy storage below.  The column must
-- therefore be nullable while rows that require manual review remain intact.
ALTER TABLE "non_batch_mappings" ALTER COLUMN "response" DROP NOT NULL;

CREATE TABLE "ai_result_migration_exceptions" (
    "customId" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_result_migration_exceptions_pkey" PRIMARY KEY ("customId", "sourceTable")
);

-- Invalid legacy JSON must not abort the schema migration or be silently lost.
CREATE OR REPLACE FUNCTION "try_jsonb"(value TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Extract the structured result from either fake-mode data or the OpenAI
-- Responses API text content. This function is only for legacy backfill.
CREATE OR REPLACE FUNCTION "legacy_ai_result"(raw JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result JSONB;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  IF raw ? 'why' OR raw ? 'randomizedPrompt' THEN RETURN raw - 'sources'; END IF;
  SELECT "try_jsonb"(content.content->>'text') INTO result
  FROM jsonb_array_elements(COALESCE(raw->'output', '[]'::jsonb)) WITH ORDINALITY AS message(item, message_order)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(message.item->'content', '[]'::jsonb)) WITH ORDINALITY AS content(content, content_order)
  WHERE content.content->>'type' IN ('text', 'output_text') AND content.content ? 'text'
  ORDER BY message_order DESC, content_order DESC
  LIMIT 1;
  RETURN result;
END;
$$;

CREATE TEMP TABLE "legacy_ai_response_candidates" AS
WITH candidates AS (
  SELECT bm."customId", b."taskId", bm."response" AS raw_response, 1 AS source_priority
  FROM "batch_mappings" bm JOIN "batches" b ON b."id" = bm."batchId"
  UNION ALL
  SELECT nbm."customId", nb."taskId", nbm."response", 1
  FROM "non_batch_mappings" nbm JOIN "non_batches" nb ON nb."id" = nbm."nonBatchId"
  UNION ALL
  SELECT l."customId", l."taskId", l."responseData", 2
  FROM "openai_logs" l
), selected AS (
  SELECT DISTINCT ON ("customId") *
  FROM candidates
  ORDER BY "customId", (raw_response IS NOT NULL) DESC, source_priority
)
SELECT s.*, l."runnerClassName", l."requestInitiated", l."responseReceived"
FROM selected s LEFT JOIN "openai_logs" l ON l."customId" = s."customId";

INSERT INTO "ai_results" (
  "customId", "taskId", "resultKind", "status", "result", "errorMessage", "requestInitiated", "responseReceived", "updatedAt"
)
SELECT
  c."customId", c."taskId",
  CASE c."runnerClassName"
    WHEN 'ScientistOnboardingRunner' THEN 'onboarding'
    WHEN 'WorthAssessmentRunner' THEN 'worth_assessment'
    WHEN 'PromptInjectionRunner' THEN 'prompt_injection'
    WHEN 'RandomizePromptRunner' THEN 'prompt_randomization'
    ELSE 'unknown'
  END,
  'SUCCEEDED', "legacy_ai_result"("try_jsonb"(c.raw_response)), NULL,
  COALESCE(c."requestInitiated", CURRENT_TIMESTAMP), c."responseReceived", CURRENT_TIMESTAMP
FROM "legacy_ai_response_candidates" c
WHERE "legacy_ai_result"("try_jsonb"(c.raw_response)) IS NOT NULL;

INSERT INTO "ai_result_migration_exceptions" ("customId", "sourceTable", "reason")
SELECT "customId", 'legacy response', 'Response was absent or could not be decoded into structured output'
FROM "legacy_ai_response_candidates"
WHERE raw_response IS NOT NULL AND "legacy_ai_result"("try_jsonb"(raw_response)) IS NULL
ON CONFLICT DO NOTHING;

-- Preserve URLs needed by the assessment/audit UI without retaining the reply.
INSERT INTO "ai_result_sources" ("aiResultId", "ordinal", "url")
SELECT result_id, (row_number() OVER (PARTITION BY result_id ORDER BY url) - 1)::INTEGER, url
FROM (
  SELECT DISTINCT r."id" AS result_id, annotation->>'url' AS url
  FROM "ai_results" r
  JOIN "legacy_ai_response_candidates" c ON c."customId" = r."customId"
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE("try_jsonb"(c.raw_response)->'output', '[]'::jsonb)) AS message(item)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(message.item->'content', '[]'::jsonb)) AS content(item)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(content.item->'annotations', '[]'::jsonb)) AS annotation(item)
  WHERE annotation.item->>'type' = 'url_citation' AND annotation.item ? 'url'
  UNION
  SELECT DISTINCT r."id", source.item->>'url'
  FROM "ai_results" r
  JOIN "legacy_ai_response_candidates" c ON c."customId" = r."customId"
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE("try_jsonb"(c.raw_response)->'output', '[]'::jsonb)) AS message(item)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(message.item->'content', '[]'::jsonb)) AS content(item)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(content.item->'sources', '[]'::jsonb)) AS source(item)
  WHERE source.item ? 'url'
) urls
WHERE url IS NOT NULL;

-- Reclaim storage only for rows proven to have a compact canonical replacement.
UPDATE "batch_mappings" m SET "response" = NULL
WHERE EXISTS (SELECT 1 FROM "ai_results" r WHERE r."customId" = m."customId" AND r."status" = 'SUCCEEDED');
UPDATE "non_batch_mappings" m SET "response" = NULL
WHERE EXISTS (SELECT 1 FROM "ai_results" r WHERE r."customId" = m."customId" AND r."status" = 'SUCCEEDED');
UPDATE "openai_logs" l SET "responseData" = NULL
WHERE EXISTS (SELECT 1 FROM "ai_results" r WHERE r."customId" = l."customId" AND r."status" = 'SUCCEEDED');

DROP FUNCTION "legacy_ai_result"(JSONB);
DROP FUNCTION "try_jsonb"(TEXT);

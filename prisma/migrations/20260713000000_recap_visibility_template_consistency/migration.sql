ALTER TABLE "MomentLog"
ADD COLUMN "templateId" TEXT NOT NULL DEFAULT 'album',
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

UPDATE "MomentLog" AS moment
SET
  "templateId" = recap."templateId",
  "visibility" = CASE
    WHEN recap."visibility" = 'public' THEN 'public'
    ELSE moment."visibility"
  END
FROM "Recap" AS recap
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(recap."moments", '[]'::jsonb)) AS recap_moment
  WHERE recap_moment ->> 'id' = moment."id"
);

UPDATE "Recap" AS recap
SET "moments" = enriched."moments"
FROM (
  SELECT
    source_recap."id",
    jsonb_agg(
      recap_moment || jsonb_build_object(
        'templateId', COALESCE(moment."templateId", source_recap."templateId"),
        'visibility', COALESCE(moment."visibility", 'private')
      )
      ORDER BY recap_moment ->> 'recordedAt'
    ) AS "moments"
  FROM "Recap" AS source_recap
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(source_recap."moments", '[]'::jsonb)) AS recap_moment
  LEFT JOIN "MomentLog" AS moment ON moment."id" = recap_moment ->> 'id'
  GROUP BY source_recap."id"
) AS enriched
WHERE recap."id" = enriched."id";

ALTER TABLE "Recap" ADD COLUMN "travelSessionId" TEXT;

WITH ranked_logs AS (
  SELECT
    recap."id",
    recap."sessionId",
    ROW_NUMBER() OVER (
      PARTITION BY recap."sessionId"
      ORDER BY recap."createdAt" DESC, recap."id" DESC
    ) AS rank
  FROM "Recap" AS recap
  INNER JOIN "TravelSession" AS session
    ON recap."sessionId" = session."id"
   AND recap."userId" = session."userId"
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(recap."moments", '[]'::jsonb)) AS recap_moment
    INNER JOIN "MomentLog" AS moment
      ON moment."id" = recap_moment ->> 'id'
     AND moment."sessionId" = recap."sessionId"
     AND moment."userId" = recap."userId"
  )
)
UPDATE "Recap" AS recap
SET "travelSessionId" = ranked_logs."sessionId"
FROM ranked_logs
WHERE recap."id" = ranked_logs."id"
  AND ranked_logs.rank = 1;

CREATE UNIQUE INDEX "Recap_travelSessionId_key" ON "Recap"("travelSessionId");

ALTER TABLE "Recap"
ADD CONSTRAINT "Recap_travelSessionId_fkey"
FOREIGN KEY ("travelSessionId") REFERENCES "TravelSession"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

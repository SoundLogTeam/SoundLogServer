ALTER TABLE "Recap"
ADD COLUMN "templateId" TEXT NOT NULL DEFAULT 'album',
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private',
ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lng" DOUBLE PRECISION;

UPDATE "Recap"
SET
  "lat" = COALESCE(
    "lat",
    NULLIF(("moments" #>> '{0,location,lat}'), '')::DOUBLE PRECISION
  ),
  "lng" = COALESCE(
    "lng",
    NULLIF(("moments" #>> '{0,location,lng}'), '')::DOUBLE PRECISION
  )
WHERE "moments" IS NOT NULL;

ALTER TABLE "MoodRecommendation"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "playlistId" TEXT;

CREATE INDEX "MoodRecommendation_playlistId_idx"
ON "MoodRecommendation"("playlistId");

ALTER TABLE "MoodRecommendation"
ADD CONSTRAINT "MoodRecommendation_playlistId_fkey"
FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

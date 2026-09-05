-- CreateTable
CREATE TABLE "RecommendationFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "subject" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "opinion" TEXT,
    "playlistId" TEXT,
    "placeId" TEXT,
    "placeName" TEXT,
    "source" TEXT,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationFeedback_subject_rating_idx" ON "RecommendationFeedback"("subject", "rating");
CREATE INDEX "RecommendationFeedback_playlistId_idx" ON "RecommendationFeedback"("playlistId");
CREATE INDEX "RecommendationFeedback_placeId_idx" ON "RecommendationFeedback"("placeId");
CREATE INDEX "RecommendationFeedback_createdAt_idx" ON "RecommendationFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

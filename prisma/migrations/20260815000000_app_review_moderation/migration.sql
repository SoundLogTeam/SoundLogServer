ALTER TABLE "User"
ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT,
ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspensionReason" TEXT;

ALTER TABLE "MomentLog"
ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN "moderationReviewedAt" TIMESTAMP(3),
ADD COLUMN "moderationReviewedBy" TEXT;

ALTER TABLE "Recap"
ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN "moderationReviewedAt" TIMESTAMP(3),
ADD COLUMN "moderationReviewedBy" TEXT;

ALTER TABLE "TravelRoomMoment"
ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE "TravelRoomMomentComment"
ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE "CommunityReport"
ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN "targetContentId" TEXT,
ADD COLUMN "contentSnapshot" JSONB,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "dueAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
ADD COLUMN "reminderSentAt" TIMESTAMP(3),
ADD COLUMN "overdueSentAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolvedBy" TEXT,
ADD COLUMN "resolution" TEXT;

CREATE INDEX "CommunityReport_status_dueAt_idx"
ON "CommunityReport"("status", "dueAt");

CREATE INDEX "CommunityReport_targetType_targetContentId_idx"
ON "CommunityReport"("targetType", "targetContentId");

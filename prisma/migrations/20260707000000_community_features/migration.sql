CREATE TABLE "TravelRoom" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "sessionId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'invite_only',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TravelRoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelRoomMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TravelRoomMoment" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "momentLogId" TEXT,
    "placeName" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "trackSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelRoomMoment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SoundMapPin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "visibility" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "approxLat" DOUBLE PRECISION NOT NULL,
    "approxLng" DOUBLE PRECISION NOT NULL,
    "travelMode" TEXT,
    "moodTags" TEXT[],
    "placeName" TEXT,
    "trackSnapshot" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoundMapPin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TravelMateRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetPinId" TEXT,
    "messageTemplate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelMateRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetPinId" TEXT,
    "requestId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TravelRoom_inviteCode_key" ON "TravelRoom"("inviteCode");
CREATE UNIQUE INDEX "TravelRoomMember_roomId_userId_key" ON "TravelRoomMember"("roomId", "userId");
CREATE UNIQUE INDEX "SoundMapPin_userId_key" ON "SoundMapPin"("userId");
CREATE UNIQUE INDEX "CommunityBlock_blockerId_blockedUserId_key" ON "CommunityBlock"("blockerId", "blockedUserId");

ALTER TABLE "TravelRoom" ADD CONSTRAINT "TravelRoom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelRoomMember" ADD CONSTRAINT "TravelRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TravelRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelRoomMember" ADD CONSTRAINT "TravelRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelRoomMoment" ADD CONSTRAINT "TravelRoomMoment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TravelRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelRoomMoment" ADD CONSTRAINT "TravelRoomMoment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SoundMapPin" ADD CONSTRAINT "SoundMapPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelMateRequest" ADD CONSTRAINT "TravelMateRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelMateRequest" ADD CONSTRAINT "TravelMateRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityBlock" ADD CONSTRAINT "CommunityBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityBlock" ADD CONSTRAINT "CommunityBlock_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelMateRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

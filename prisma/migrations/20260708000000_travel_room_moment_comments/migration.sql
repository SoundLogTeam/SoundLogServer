-- CreateTable
CREATE TABLE "TravelRoomMomentComment" (
    "id" TEXT NOT NULL,
    "momentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelRoomMomentComment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TravelRoomMomentComment" ADD CONSTRAINT "TravelRoomMomentComment_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "TravelRoomMoment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRoomMomentComment" ADD CONSTRAINT "TravelRoomMomentComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

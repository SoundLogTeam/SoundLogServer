CREATE TABLE "DbTestRecord" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DbTestRecord_pkey" PRIMARY KEY ("id")
);

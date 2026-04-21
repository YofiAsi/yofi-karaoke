-- CreateEnum
CREATE TYPE "QueueState" AS ENUM ('queued', 'processing', 'ready', 'played', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "ProcessingStep" AS ENUM ('pending', 'downloading', 'separating', 'fetching_lyrics', 'done', 'error');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Song" (
    "id" UUID NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "instrumentalObjectKey" TEXT,
    "originalObjectKey" TEXT,
    "lyricsLrc" TEXT,
    "lyricsSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "state" "QueueState" NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedAt" TIMESTAMP(3),

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "step" "ProcessingStep" NOT NULL DEFAULT 'pending',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "currentQueueItemId" UUID,
    "positionSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "hostUserId" UUID,
    "hostLastHeartbeatAt" TIMESTAMP(3),
    "playerUserId" UUID,
    "playerLastHeartbeatAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

-- CreateIndex
CREATE INDEX "User_name_idx" ON "User"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Song_youtubeVideoId_key" ON "Song"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "Song_title_idx" ON "Song"("title");

-- CreateIndex
CREATE INDEX "Song_artist_idx" ON "Song"("artist");

-- CreateIndex
CREATE INDEX "QueueItem_state_position_idx" ON "QueueItem"("state", "position");

-- CreateIndex
CREATE INDEX "ProcessingJob_songId_idx" ON "ProcessingJob"("songId");

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Singleton enforcement for PlaybackState
ALTER TABLE "PlaybackState" ADD CONSTRAINT "PlaybackState_singleton" CHECK ("id" = 1);

-- Seed the singleton row
INSERT INTO "PlaybackState" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

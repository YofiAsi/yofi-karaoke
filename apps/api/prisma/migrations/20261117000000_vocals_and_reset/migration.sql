-- DESTRUCTIVE: deploying this migration deletes every Song, QueueItem and ProcessingJob row and resets playback.
-- Songs processed before this release have no vocals stem, so the owner chose to remove them all.
-- Stored audio objects are not touched here; run `corepack pnpm --filter api purge:objects` manually afterwards.

ALTER TABLE "Song" ADD COLUMN "vocalsObjectKey" TEXT;
ALTER TABLE "PlaybackState" ADD COLUMN "vocalsGain" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "PlaybackState"
   SET "currentQueueItemId" = NULL,
       "positionSeconds" = 0,
       "isPlaying" = false;

DELETE FROM "QueueItem";
DELETE FROM "ProcessingJob";
DELETE FROM "Song";

CREATE UNIQUE INDEX "QueueItem_songId_active_key" ON "QueueItem"("songId") WHERE "state" IN ('queued','processing','ready');

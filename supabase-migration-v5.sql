-- ═══════════════════════════════════════════════════════════
-- PG Builders — Migration v5: Broadcast Title
-- Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

ALTER TABLE broadcast_announcements ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'Broadcast Announcement';

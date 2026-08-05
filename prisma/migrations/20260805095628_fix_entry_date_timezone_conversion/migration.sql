-- The backfill in 20260805093117_add_order_entry_date applied
-- `"createdAt" AT TIME ZONE 'Asia/Bangkok'` directly to a `timestamp without
-- time zone` column (Prisma's default mapping for DateTime — it stores raw
-- UTC clock digits with no zone attached). Postgres's `AT TIME ZONE` on a
-- naive timestamp does the OPPOSITE conversion from what was intended: it
-- treats the value as already being local time in that zone and converts it
-- BACK to UTC, instead of treating it as UTC and converting it TO that zone.
-- That silently shifted entryDate a day early for any order whose real
-- Bangkok-local creation time fell between 07:00 and 13:59 (any order
-- created in that window, on any day, since subtracting 7 hours crosses back
-- over midnight only in that range). The correct idiom is the double
-- conversion below — first assert the naive value IS UTC, then convert that
-- to Bangkok local time.
UPDATE "Order"
SET "entryDate" = to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD');

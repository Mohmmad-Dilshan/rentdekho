-- Supports the public published-listing feed ordered by newest first with cursor pagination.
CREATE INDEX "Listing_status_createdAt_id_idx" ON "Listing"("status", "createdAt" DESC, "id" DESC);

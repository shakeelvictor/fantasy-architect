-- Hosted-platform wiring: Supabase Realtime's postgres_changes only carries
-- tables in the supabase_realtime publication. Clients subscribe to INSERTs
-- on draft_events and fold them through @fa/rules — this is the whole
-- realtime surface, so it is the only table published.
alter publication supabase_realtime add table draft_events;

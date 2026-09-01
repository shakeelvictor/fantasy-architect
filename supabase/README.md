# Supabase deployment

Everything here is tested locally against PGlite (real Postgres semantics,
including RLS under the anon/authenticated roles) — no cloud project needed
for development. To stand up the real thing:

1. Create the project (free tier), then link and push:
   supabase link --project-ref <ref>
   supabase db push
2. Seed a season + teams + PIN rows. PIN hashes are sha256(salt || pin):
   printf '<salt><pin>' | shasum -a 256
   insert into seasons (year, config) values (2027,
     '{"teams":11,"rounds":20,"type":"linear","order":[...]}');
   insert into pins (season, role, slot, salt, pin_hash) values
     (2027, 'commish', null, '<salt>', '<hash>'),
     (2027, 'team', 1, '<salt>', '<hash>'), ...;
3. Deploy the auth function and its secret (the project's legacy JWT secret,
   so PostgREST accepts the minted tokens):
   supabase secrets set FA_JWT_SECRET=<jwt-secret>
   supabase functions deploy auth-pin --no-verify-jwt
4. Keep-warm (free tier pauses after ~1 week idle): a weekly GitHub Actions
   cron hitting fold_state via PostgREST is enough:
   curl "$SUPABASE_URL/rest/v1/rpc/fold_state" -X POST \
     -H "apikey: $ANON_KEY" -d '{"p_season": 2027}'

Clients authenticate by POSTing {season, pin} to the auth-pin function and
using the returned JWT as the Authorization bearer for PostgREST + Realtime
(subscribe to postgres_changes INSERTs on draft_events, fold with
@fa/rules). Spectators use the plain anon key: read-everything, write-nothing.

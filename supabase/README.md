# Supabase deployment

**Deployed 1 Sep 2026** — project `fantasy-architect`, ref
`prkdvoyxtdwwzeqqrzcq`, us-east-2, Postgres 17. Both migrations applied,
auth-pin live with FA_JWT_SECRET, season 2027 + teams seeded. **2027's PIN
rows were deleted on 24 Oct 2026**, when the repo went public: they were 4
digits behind only a flat 600ms wrong-guess delay, which parallel requests
brute-force fast. Nobody can sign in to 2027 until step 2 below re-seeds them —
do it with longer PINs (or add a lockout to auth-pin) before draft night.
Verified end-to-end: 20/20 hosted checks (PIN auth, guards, keeper chain,
RLS slot cage, append-only log). Credentials: `~/.config/fa2/supabase.env`;
league PINs: `~/.config/fa2/pins-2027.txt` (both local-only, mode 600; the
PINs file now lists the deleted PINs and is stale until re-seeding).

Note: on new-generation projects the legacy JWT secret is dashboard-only
(Settings → JWT Keys → Legacy JWT Secret) — no Management API reveals it,
and `app.settings.jwt_secret` is absent from the database. Validate a copied
secret locally by recomputing the legacy anon key's HMAC before setting it.

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
   supabase functions deploy mfl --no-verify-jwt
   (mfl is the MyFantasyLeague proxy — MFL has no CORS. `setup` is open,
   public MFL data only; `push` requires a commissioner JWT, verified with
   the same FA_JWT_SECRET. Deployed + verified 1 Sep 2026 against the real
   2026 league; the 2027 MFL site 404s until the league renews there.)
4. Keep-warm (free tier pauses after ~1 week idle): a weekly GitHub Actions
   cron hitting fold_state via PostgREST is enough:
   curl "$SUPABASE_URL/rest/v1/rpc/fold_state" -X POST \
     -H "apikey: $ANON_KEY" -d '{"p_season": 2027}'

Clients authenticate by POSTing {season, pin} to the auth-pin function and
using the returned JWT as the Authorization bearer for PostgREST + Realtime
(subscribe to postgres_changes INSERTs on draft_events, fold with
@fa/rules). Spectators use the plain anon key: read-everything, write-nothing.

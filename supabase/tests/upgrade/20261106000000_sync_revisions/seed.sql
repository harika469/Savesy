-- Existing Savesy data as written by the current app (direct upserts, before server revisions),
-- then a fingerprint of every row so check.sql can prove nothing was lost or altered.
\set ON_ERROR_STOP on

-- user_demo: the app's seed content (constants/seed.ts) plus real-world shapes
insert into public.collections (user_id, id, name, created_at, updated_at) values
  ('user_demo', 'trips', '✈ Main character trips', '2026-01-04T12:00:00Z', '2026-01-04T12:00:00Z'),
  ('user_demo', 'buy',   '♧ I might buy this',     '2026-01-05T12:00:00Z', '2026-01-05T12:00:00Z'),
  ('user_demo', 'eat',   '♨ Need to eat this',     '2026-01-06T12:00:00Z', '2026-09-01T08:00:00Z'),
  ('user_demo', 'brain', '✦ Big brain energy',     '2026-01-07T12:00:00Z', '2026-01-07T12:00:00Z');
insert into public.saves (user_id, id, url, title, note, type, source, image_url, tags, collection_id, is_favorite, created_at, updated_at, last_rediscovered_at, details) values
  ('user_demo', 'prague-pasta', 'https://maps.google.com/?q=Prague+pasta', 'That pasta place in Prague', 'Book the tiny table by the window.', 'place', 'Google Maps', null, '{prague,pasta,trip}', 'trips', true, '2026-08-22T12:00:00Z', '2026-08-22T12:00:00Z', '2026-10-01T09:00:00Z',
     '{"kind":"place","name":"Pasta Fresca","category":"restaurant","address":"Celetná 11","city":"Prague","country":"Czechia"}'),
  ('user_demo', 'focus-playlist', 'https://open.spotify.com/', 'Focus playlist for deep work', 'No lyrics, genuinely useful.', 'other', 'Spotify', null, '{music,focus}', 'brain', false, '2026-08-27T13:00:00Z', '2026-08-27T13:00:00Z', null, null),
  ('user_demo', 'green-dress', 'https://example.com/green-linen-dress', 'Green linen midi dress', 'This would work for summer dinners.', 'product', 'Product', 'https://example.com/dress.jpg', '{green dress,linen,outfit}', 'buy', true, '2026-08-24T11:00:00Z', '2026-08-30T10:00:00Z', null,
     '{"kind":"product","name":"Linen midi dress","brand":"Example","price":"79.00","currency":"EUR","store":"Example"}'),
  ('user_demo', 'ramen', 'https://example.com/ramen', '15-minute sesame ramen', 'Add chili crisp. 🌶️ 辛い', 'video', 'TikTok', null, '{ramen,dinner}', 'eat', false, '2026-08-18T11:00:00Z', '2026-08-18T11:00:00Z', null,
     '{"kind":"recipe","name":"Sesame ramen","ingredients":["ramen noodles","tahini","soy sauce","chili crisp"],"totalTime":"15 min","steps":"Whisk, boil, toss."}'),
  ('user_demo', 'no-collection', 'https://www.youtube.com/watch?v=abc', 'A video worth coming back to', null, 'video', 'YouTube', null, '{}', null, false, '2026-08-12T11:00:00Z', '2026-08-12T11:00:00Z', null, null),
  ('user_demo', 'long-note', 'https://example.com/long', 'Long note', repeat('A long note line. ', 400), 'article', 'Example', null, '{reading}', null, false, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', null, null);

-- user_big: 3 collections + 1,200 saves over 120 distinct timestamps (10 saves share each), some in collections
insert into public.collections (user_id, id, name, created_at, updated_at)
select 'user_big', 'col' || g, 'Collection ' || g, '2026-01-01T00:00:00Z'::timestamptz + (g || ' days')::interval, '2026-01-01T00:00:00Z'::timestamptz + (g || ' days')::interval from generate_series(1, 3) g;
insert into public.saves (user_id, id, url, title, type, tags, collection_id, is_favorite, created_at, updated_at)
select 'user_big', 'b' || lpad(g::text, 4, '0'), 'https://example.com/item/' || g, 'Item ' || g, 'article', array['tag' || (g % 7)],
       case when g % 4 = 0 then 'col' || (1 + g % 3) end, g % 9 = 0,
       '2026-02-01T00:00:00Z'::timestamptz + ((g / 10) || ' hours')::interval, '2026-02-01T00:00:00Z'::timestamptz + ((g / 10) || ' hours')::interval
from generate_series(1, 1200) g;

-- user_ties: a collection and saves with identical timestamps; the collection must be numbered first
insert into public.collections (user_id, id, name, created_at, updated_at) values ('user_ties', 'zz-col', 'Same second', '2026-05-05T05:05:05Z', '2026-05-05T05:05:05Z');
insert into public.saves (user_id, id, url, title, type, tags, collection_id, is_favorite, created_at, updated_at)
select 'user_ties', 'aa' || g, 'https://t/' || g, 'Tie ' || g, 'other', '{}', 'zz-col', false, '2026-05-05T05:05:05Z', '2026-05-05T05:05:05Z' from generate_series(1, 3) g;

-- Unrelated data that must come through untouched
insert into public.entitlements (user_id, source) values ('user_demo', 'manual');
insert into public.ai_usage (user_id, month, used) values ('user_demo', '2026-10-01', 4), ('user_nosaves', '2026-11-01', 2);
insert into public.pro_interest (user_id, plan) values ('user_demo', 'yearly');

-- Fingerprints (outside public so nothing here is exposed)
create schema upgrade_check;
create table upgrade_check.rows as
  select 'saves' as tbl, user_id, id, updated_at, md5(to_jsonb(s)::text) as fp from public.saves s
  union all
  select 'collections', user_id, id, updated_at, md5(to_jsonb(c)::text) from public.collections c;
create table upgrade_check.other as
  select 'entitlements' as tbl, md5(coalesce(string_agg(to_jsonb(e)::text, '|' order by user_id), '')) as fp from public.entitlements e
  union all select 'ai_usage', md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by user_id, month), '')) from public.ai_usage u
  union all select 'pro_interest', md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by user_id), '')) from public.pro_interest p;
select count(*) || ' rows fingerprinted before the upgrade' from upgrade_check.rows;

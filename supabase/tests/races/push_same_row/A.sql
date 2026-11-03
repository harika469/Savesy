-- Session A: creates c1 (rev 1), then pushes an edit from rev 1 and holds uR's sync lock for 3 s.
set role authenticated; set request.jwt.claims = '{"sub":"uR"}';
select public.push_changes('[{"table":"saves","id":"c1","base_rev":0,"op":"upsert","row":{"url":"https://c.com","title":"v1"}}]') \g /dev/null
begin;
select (public.push_changes('[{"table":"saves","id":"c1","base_rev":1,"op":"upsert","row":{"url":"https://c.com","title":"from A"}}]'))->0->>'status' = 'applied' as a_applied \gset
\if :a_applied
\else
  \echo 'not ok - session A push not applied'
  \quit 3
\endif
select pg_sleep(3);
commit;

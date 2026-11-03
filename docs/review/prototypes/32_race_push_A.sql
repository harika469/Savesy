-- P8 session A: pushes c1 from rev 1 and holds the user's sync lock for 3 s.
set role authenticated; set request.jwt.claims = '{"sub":"uR"}';
begin;
select (public.push_changes('[{"table":"saves","id":"c1","base_rev":1,"op":"upsert","row":{"url":"https://c.com","title":"from A"}}]'))->0->>'status' = 'applied' as a_applied \gset
\if :a_applied
\else
  \echo 'not ok - P8 session A push not applied'
  \quit 3
\endif
select pg_sleep(3);
commit;

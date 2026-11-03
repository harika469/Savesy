-- Session A: an old tombstone exists; A restores it through push_changes and holds the user's sync lock for 3 s.
set role authenticated; set request.jwt.claims = '{"sub":"uX"}';
select public.push_changes('[{"table":"saves","id":"t","base_rev":0,"op":"upsert","row":{"url":"https://t","title":"t"}}]') \g /dev/null
select public.push_changes('[{"table":"saves","id":"t","base_rev":1,"op":"delete"}]') \g /dev/null
reset role;
update public.saves set deleted_at = now() - interval '100 days' where user_id = 'uX' and id = 't';
set role authenticated; set request.jwt.claims = '{"sub":"uX"}';
begin;
select (public.push_changes('[{"table":"saves","id":"t","base_rev":2,"op":"restore","row":{"url":"https://t","title":"kept"}}]'))->0->>'status' = 'applied' as a_applied \gset
\if :a_applied
\else
  \echo 'not ok - session A restore not applied'
  \quit 3
\endif
select pg_sleep(3);
commit;

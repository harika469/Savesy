set role authenticated; set request.jwt.claims = '{"sub":"uC"}';
begin; select 'A:' || (push_changes('[{"table":"saves","id":"c1","base_rev":1,"op":"upsert","row":{"url":"https://c.com","title":"from A"}}]')->0->>'status'); select pg_sleep(1.5); commit;

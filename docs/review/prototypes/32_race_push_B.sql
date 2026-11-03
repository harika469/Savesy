set role authenticated; set request.jwt.claims = '{"sub":"uC"}';
begin; select 'B:' || (push_changes('[{"table":"saves","id":"c1","base_rev":1,"op":"upsert","row":{"url":"https://c.com","title":"from B"}}]')->0->>'status'); commit;

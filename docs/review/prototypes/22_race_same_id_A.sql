set role authenticated; set request.jwt.claims = '{"sub":"r1"}';
begin; select 'A:' || (reserve_ai_credit('99999999-9999-9999-9999-999999999999'))::text; select pg_sleep(1.5); commit;

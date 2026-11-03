set role authenticated; set request.jwt.claims = '{"sub":"r2"}';
begin; select 'X:' || ((reserve_ai_credit(gen_random_uuid()))->>'allowed'); select pg_sleep(1.5); commit;

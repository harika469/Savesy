set role authenticated; set request.jwt.claims = '{"sub":"r2"}';
begin; select 'Y:' || ((reserve_ai_credit(gen_random_uuid()))->>'allowed'); commit;

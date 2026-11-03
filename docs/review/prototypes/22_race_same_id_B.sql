set role authenticated; set request.jwt.claims = '{"sub":"r1"}';
begin; select 'B:' || (reserve_ai_credit('99999999-9999-9999-9999-999999999999'))::text; commit;

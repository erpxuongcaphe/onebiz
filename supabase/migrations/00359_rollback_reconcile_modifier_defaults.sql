-- 00359 rollback is intentionally a no-op. The previous duplicate-default
-- state was invalid business data and cannot be reconstructed safely.
select true as rollback_00359_noop;

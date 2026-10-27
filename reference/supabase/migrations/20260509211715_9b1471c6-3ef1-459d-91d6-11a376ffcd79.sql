REVOKE EXECUTE ON FUNCTION public.cleanup_enum_violation_30d() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_enum_violation_30d() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_enum_violation_30d() FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_enum_violation_30d() TO service_role;
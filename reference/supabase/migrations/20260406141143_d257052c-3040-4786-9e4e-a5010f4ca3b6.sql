-- Drop the duplicate trigger that causes unique constraint violation on signup
DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;

-- Drop the obsolete function (handle_new_user already handles this with 60 credits)
DROP FUNCTION IF EXISTS public.handle_new_user_subscription();
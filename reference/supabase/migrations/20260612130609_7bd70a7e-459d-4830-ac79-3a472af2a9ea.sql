drop policy if exists "Users insert own films" on public.films;
drop policy if exists "Users update own films" on public.films;
drop policy if exists "Users delete own films" on public.films;

drop policy if exists "Users update own inbox" on public.film_client_inbox;
drop policy if exists "Users delete own inbox" on public.film_client_inbox;

alter table public.film_client_inbox
  add constraint film_client_inbox_op_check
  check (op in ('feedback','answer','reject_board','approve_ship'));
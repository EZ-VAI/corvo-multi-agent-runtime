create table public.films (
  film_id text primary key,
  user_id uuid not null,
  status text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.films to authenticated;
grant all on public.films to service_role;

alter table public.films enable row level security;

create policy "Users view own films" on public.films
  for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own films" on public.films
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own films" on public.films
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own films" on public.films
  for delete to authenticated using (auth.uid() = user_id);

create trigger films_set_updated_at
  before update on public.films
  for each row execute function public.set_updated_at();

create table public.film_client_inbox (
  id uuid primary key default gen_random_uuid(),
  film_id text not null,
  user_id uuid not null,
  op text not null,
  board_id text,
  note text,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.film_client_inbox to authenticated;
grant all on public.film_client_inbox to service_role;

alter table public.film_client_inbox enable row level security;

create policy "Users view own inbox" on public.film_client_inbox
  for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own inbox" on public.film_client_inbox
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own inbox" on public.film_client_inbox
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own inbox" on public.film_client_inbox
  for delete to authenticated using (auth.uid() = user_id);

create index film_client_inbox_film_idx on public.film_client_inbox(film_id, consumed, created_at);

alter publication supabase_realtime add table public.films;
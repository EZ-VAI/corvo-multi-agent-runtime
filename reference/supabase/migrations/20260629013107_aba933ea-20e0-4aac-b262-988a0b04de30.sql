create table if not exists public.brand_skill (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null default 1,
  source text not null default 'measured',
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  coordinates jsonb not null default '{}'::jsonb,
  positioning jsonb not null default '[]'::jsonb,
  scale int not null default 50,
  aspiration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_skill_user_unique unique (user_id)
);

grant select, insert, update, delete on public.brand_skill to authenticated;
grant all on public.brand_skill to service_role;

alter table public.brand_skill enable row level security;

drop policy if exists bs_sel on public.brand_skill;
drop policy if exists bs_ins on public.brand_skill;
drop policy if exists bs_upd on public.brand_skill;
create policy bs_sel on public.brand_skill for select to authenticated using (auth.uid() = user_id);
create policy bs_ins on public.brand_skill for insert to authenticated with check (auth.uid() = user_id);
create policy bs_upd on public.brand_skill for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists bs_touch on public.brand_skill;
create trigger bs_touch before update on public.brand_skill for each row execute function public.touch_updated_at();
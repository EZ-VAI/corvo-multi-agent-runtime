
create table public.brand_model (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '未命名模特',
  source text not null check (source in ('generated','uploaded')),
  gender text,
  height_cm int,
  bust_cm int,
  waist_cm int,
  hip_cm int,
  shoulder_cm int,
  sheet_url text,
  front_url text,
  side_url text,
  back_url text,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.brand_model to authenticated;
grant all on public.brand_model to service_role;

alter table public.brand_model enable row level security;

create policy "own brand_model select" on public.brand_model for select using (auth.uid() = user_id);
create policy "own brand_model insert" on public.brand_model for insert with check (auth.uid() = user_id);
create policy "own brand_model update" on public.brand_model for update using (auth.uid() = user_id);
create policy "own brand_model delete" on public.brand_model for delete using (auth.uid() = user_id);

create trigger brand_model_set_updated_at before update on public.brand_model
  for each row execute function public.update_updated_at_column();

-- storage.objects policies for brand-models bucket (private; signed URLs in app)
create policy "own brand-models insert" on storage.objects for insert
  with check (bucket_id = 'brand-models' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own brand-models select" on storage.objects for select
  using (bucket_id = 'brand-models' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own brand-models delete" on storage.objects for delete
  using (bucket_id = 'brand-models' and auth.uid()::text = (storage.foldername(name))[1]);

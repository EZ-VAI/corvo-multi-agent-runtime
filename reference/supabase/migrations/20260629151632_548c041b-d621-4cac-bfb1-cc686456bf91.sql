alter table public.brand_model add column if not exists is_library boolean not null default false;
update public.brand_model set is_library = true where is_library = false;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id text not null unique,
  display_name text not null,
  role text not null check (role in ('operator', 'admin', 'viewer')),
  language text not null default 'ko' check (language in ('ko', 'vi')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  version bigint not null default 1
);

create table public.models (
  id uuid primary key default gen_random_uuid(), code text not null, name text not null,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.processes (
  id uuid primary key default gen_random_uuid(), code text not null, name text not null,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.lines (
  id uuid primary key default gen_random_uuid(), code text not null, name text not null,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(), code text not null, name text not null,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.time_slots (
  id uuid primary key default gen_random_uuid(), shift_id uuid not null references public.shifts(id),
  code text not null, starts_at time not null, ends_at time not null,
  end_day_offset smallint not null default 0 check (end_day_offset in (0, 1)),
  sequence integer not null check (sequence > 0), is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
  version bigint not null default 1, deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.downtime_reasons (
  id uuid primary key default gen_random_uuid(), code text not null, name text not null,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.yield_targets (
  id uuid primary key default gen_random_uuid(), model_id uuid references public.models(id),
  process_id uuid not null references public.processes(id), line_id uuid references public.lines(id),
  target_percent numeric not null check (target_percent >= 0 and target_percent <= 100),
  effective_from date not null, effective_to date,
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
  version bigint not null default 1, deleted_at timestamptz, deleted_by uuid references auth.users(id),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.standard_times (
  id uuid primary key default gen_random_uuid(), model_id uuid not null references public.models(id),
  process_id uuid not null references public.processes(id), line_id uuid not null references public.lines(id),
  seconds_per_unit numeric not null, effective_from date not null, effective_to date,
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
  version bigint not null default 1, deleted_at timestamptz, deleted_by uuid references auth.users(id),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.production_records (
  id uuid primary key default gen_random_uuid(), production_date date not null,
  shift_id uuid not null references public.shifts(id), time_slot_id uuid not null references public.time_slots(id),
  line_id uuid not null references public.lines(id), model_id uuid not null references public.models(id),
  process_id uuid not null references public.processes(id), input_qty integer not null default 0 check (input_qty >= 0),
  actual_qty integer not null default 0 check (actual_qty >= 0), note text not null default '',
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
  version bigint not null default 1, deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.quality_records (
  id uuid primary key default gen_random_uuid(), production_record_id uuid references public.production_records(id),
  production_date date not null, line_id uuid not null references public.lines(id), model_id uuid not null references public.models(id),
  process_id uuid not null references public.processes(id), input_qty integer not null, ok_qty integer not null,
  ng_qty integer not null, note text not null default '', created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.defect_records (
  id uuid primary key default gen_random_uuid(), quality_record_id uuid not null references public.quality_records(id),
  defect_type text not null, classification text not null check (classification in ('pseudo', 'real', 'scrap')),
  quantity integer not null check (quantity > 0), note text not null default '',
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
  version bigint not null default 1, deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.downtime_records (
  id uuid primary key default gen_random_uuid(), production_record_id uuid not null references public.production_records(id),
  reason_id uuid not null references public.downtime_reasons(id), minutes integer not null check (minutes >= 0),
  note text not null default '', created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.upload_batches (
  id uuid primary key default gen_random_uuid(), source_file_name text not null, storage_path text not null,
  workbook_kind text not null, status text not null default 'staged'
    check (status in ('staged', 'validated', 'committed', 'failed')),
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
  version bigint not null default 1, deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.upload_rows (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.upload_batches(id),
  source_sheet text not null, source_row integer not null check (source_row > 0), payload jsonb not null,
  status text not null check (status in ('new', 'conflict', 'error')), messages jsonb not null default '[]'::jsonb,
  production_record_id uuid references public.production_records(id), created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1,
  deleted_at timestamptz, deleted_by uuid references auth.users(id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id), table_name text not null,
  record_id uuid not null, action text not null check (action in ('insert', 'update', 'delete', 'restore')),
  before_data jsonb, after_data jsonb, created_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id), version bigint not null default 1
);

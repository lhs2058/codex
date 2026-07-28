create extension if not exists btree_gist;

alter table public.quality_records add constraint quality_counts_valid
  check (input_qty >= 0 and ok_qty >= 0 and ng_qty >= 0
    and ok_qty <= input_qty and ok_qty + ng_qty <= input_qty);

alter table public.standard_times add constraint standard_times_positive
  check (seconds_per_unit > 0);

alter table public.standard_times add constraint standard_times_no_overlapping_effective_period
  exclude using gist (
    model_id with =,
    process_id with =,
    line_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (deleted_at is null);

create unique index models_unique_code on public.models (code) where deleted_at is null;
create unique index processes_unique_code on public.processes (code) where deleted_at is null;
create unique index lines_unique_code on public.lines (code) where deleted_at is null;
create unique index shifts_unique_code on public.shifts (code) where deleted_at is null;
create unique index downtime_reasons_unique_code on public.downtime_reasons (code) where deleted_at is null;
create unique index time_slots_unique_shift_code on public.time_slots (shift_id, code) where deleted_at is null;

create unique index production_records_unique_slot
  on public.production_records (production_date, shift_id, time_slot_id, line_id, model_id, process_id)
  where deleted_at is null;

create index production_records_filter_idx
  on public.production_records (production_date, line_id, model_id, process_id)
  where deleted_at is null;
create index quality_records_filter_idx
  on public.quality_records (production_date, line_id, model_id, process_id)
  where deleted_at is null;
create index standard_times_effective_lookup_idx
  on public.standard_times (model_id, process_id, line_id, effective_from desc)
  where deleted_at is null;
create index downtime_records_production_record_idx on public.downtime_records (production_record_id)
  where deleted_at is null;
create index defect_records_quality_record_idx on public.defect_records (quality_record_id)
  where deleted_at is null;
create index upload_rows_batch_idx on public.upload_rows (batch_id, status) where deleted_at is null;
create index audit_logs_record_idx on public.audit_logs (table_name, record_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.models enable row level security;
alter table public.processes enable row level security;
alter table public.lines enable row level security;
alter table public.shifts enable row level security;
alter table public.time_slots enable row level security;
alter table public.downtime_reasons enable row level security;
alter table public.yield_targets enable row level security;
alter table public.standard_times enable row level security;
alter table public.production_records enable row level security;
alter table public.quality_records enable row level security;
alter table public.defect_records enable row level security;
alter table public.downtime_records enable row level security;
alter table public.upload_batches enable row level security;
alter table public.upload_rows enable row level security;
alter table public.audit_logs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

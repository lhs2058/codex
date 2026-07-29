-- Daily AOI/SPI/ICT/XRAY quality rows are first-class quality observations.
-- They intentionally have no production row and no fabricated time slot.
alter table public.quality_records
  add column shift_id uuid references public.shifts(id),
  add column time_slot_id uuid,
  add column source_upload_row_id uuid;

update public.quality_records as quality
set shift_id = production.shift_id,
    time_slot_id = production.time_slot_id
from public.production_records as production
where production.id = quality.production_record_id
  and (quality.shift_id is null or quality.time_slot_id is null);

do $$
begin
  if exists (
    select 1
    from public.quality_records
    where production_record_id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'legacy_unlinked_quality_requires_shift_mapping';
  end if;
end
$$;

alter table public.quality_records
  add constraint quality_records_time_slot_shift_fk
    foreign key (time_slot_id, shift_id)
    references public.time_slots (id, shift_id),
  add constraint quality_records_observation_shape
    check (
      (
        production_record_id is not null
        and shift_id is not null
        and time_slot_id is not null
      )
      or
      (
        production_record_id is null
        and shift_id is not null
      )
    ) not valid;

alter table public.quality_records
  validate constraint quality_records_observation_shape;

create unique index quality_records_active_production_unique
  on public.quality_records (production_record_id)
  where production_record_id is not null and deleted_at is null;

create unique index quality_records_daily_unique
  on public.quality_records (
    production_date,
    shift_id,
    line_id,
    model_id,
    process_id
  )
  where production_record_id is null
    and time_slot_id is null
    and deleted_at is null;

create unique index quality_records_unlinked_slot_unique
  on public.quality_records (
    production_date,
    shift_id,
    time_slot_id,
    line_id,
    model_id,
    process_id
  )
  where production_record_id is null
    and time_slot_id is not null
    and deleted_at is null;

create index quality_records_shift_slot_filter_idx
  on public.quality_records (
    production_date,
    shift_id,
    time_slot_id,
    line_id,
    model_id,
    process_id
  )
  where deleted_at is null;

-- A staged row carries the exact record/version reviewed by the user. The
-- committed record IDs are separate outputs populated only by the RPC.
alter table public.upload_rows
  add column row_kind text not null default 'production'
    check (row_kind in ('production', 'daily_quality', 'defect', 'diagnostic')),
  add column target_record_id uuid,
  add column expected_target_version bigint,
  add column parent_upload_row_id uuid references public.upload_rows(id),
  add column quality_record_id uuid references public.quality_records(id),
  add column defect_record_id uuid references public.defect_records(id),
  add constraint upload_rows_target_version_pair
    check (
      (target_record_id is null and expected_target_version is null)
      or
      (
        target_record_id is not null
        and expected_target_version is not null
        and expected_target_version > 0
      )
    );

alter table public.quality_records
  add constraint quality_records_source_upload_row_fk
    foreign key (source_upload_row_id)
    references public.upload_rows(id);

alter table public.defect_records
  add column source_upload_row_id uuid references public.upload_rows(id);

create unique index quality_records_source_upload_row_unique
  on public.quality_records (source_upload_row_id)
  where source_upload_row_id is not null;

create unique index defect_records_source_upload_row_unique
  on public.defect_records (source_upload_row_id)
  where source_upload_row_id is not null;

create unique index defect_records_active_natural_key
  on public.defect_records (quality_record_id, defect_type, classification)
  where deleted_at is null;

create index upload_rows_parent_idx
  on public.upload_rows (parent_upload_row_id)
  where parent_upload_row_id is not null and deleted_at is null;

create index upload_rows_target_idx
  on public.upload_rows (target_record_id, expected_target_version)
  where target_record_id is not null and deleted_at is null;

insert into public.downtime_reasons (code, name, is_active)
values ('LEGACY_UNSPECIFIED', 'Legacy / unspecified', true)
on conflict (code) where deleted_at is null
do update
set name = excluded.name,
    is_active = true,
    updated_at = now();

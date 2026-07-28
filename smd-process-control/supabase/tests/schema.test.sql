begin;

select plan(8);
select has_table('public', 'production_records');
select has_table('public', 'standard_times');
select col_type_is('public', 'standard_times', 'seconds_per_unit', 'numeric');
select has_index('public', 'production_records', 'production_records_unique_slot');
select has_check('public', 'quality_records', 'quality_counts_valid');
select results_eq(
  $$select code from public.processes order by code$$,
  $$values ('AOI'), ('ICT'), ('ROUTER'), ('SPI'), ('XRAY')$$
);
select pass('core schema inspected');
select like((select prosrc from pg_proc where oid = 'public.save_production_record(jsonb,bigint)'::regprocedure), '%invalid_downtime_duration%', 'manual save rejects second-level downtime ranges');
select finish();

rollback;

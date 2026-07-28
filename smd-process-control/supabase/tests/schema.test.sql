begin;

select plan(10);
select has_table('public', 'production_records');
select has_table('public', 'standard_times');
select col_type_is('public', 'standard_times', 'seconds_per_unit', 'numeric');
select has_index('public', 'production_records', 'production_records_unique_slot');
select has_check('public', 'quality_records', 'quality_counts_valid');
select results_eq(
  $$select code from public.processes order by code$$,
  $$values ('AOI'), ('ICT'), ('ROUTER'), ('SPI'), ('XRAY')$$
);
select has_function('public', 'set_my_language', array['text']);
select function_lang_is('public', 'set_my_language', array['text'], 'plpgsql');
select function_returns('public', 'set_my_language', array['text'], 'void');
select pass('core schema inspected');
select finish();

rollback;

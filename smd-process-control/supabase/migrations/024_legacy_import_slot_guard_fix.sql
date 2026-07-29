-- Forward-only repair for migration 023.
--
-- PostgreSQL does not guarantee left-to-right evaluation of boolean
-- subexpressions. A RECORD has no fields until its first assignment, so the
-- migration 023 expression could inspect slot_definition for a non-slot
-- candidate and raise 55000. Patch only the two affected fragments and abort
-- unless the expected function definition is present exactly once.

do $migration$
declare
  function_signature constant regprocedure :=
    'public.commit_upload_batch_with_masters(uuid,boolean,jsonb,jsonb)'
      ::regprocedure;
  function_definition text;
  dispatch_unsafe constant text := $dispatch_unsafe$    elsif master_candidate.entity = 'downtime_reason' then
      select reason.id, reason.name, reason.is_active
      into existing_id, existing_name, existing_active
      from public.downtime_reasons as reason
      where reason.code = master_candidate.normalized_code
        and reason.deleted_at is null;
    else
      select *
      into slot_definition
      from private.legacy_slot_definition(
        master_candidate.parent_code,
        master_candidate.normalized_code
      );
      if not found
        or (master_candidate.proposed_data ->> 'startsAt')::time
          is distinct from slot_definition.expected_starts_at
        or (master_candidate.proposed_data ->> 'endsAt')::time
          is distinct from slot_definition.expected_ends_at
        or (master_candidate.proposed_data ->> 'endDayOffset')::smallint
          is distinct from slot_definition.expected_end_day_offset
        or (master_candidate.proposed_data ->> 'sequence')::integer
          is distinct from slot_definition.expected_sequence then
        raise exception using
          errcode = '22023',
          message = 'invalid_time_slot';
      end if;
      select shift.id
      into resolved_shift_id
      from public.shifts as shift
      where shift.code = master_candidate.parent_code
        and shift.is_active
        and shift.deleted_at is null;
      if resolved_shift_id is null then
        raise exception using
          errcode = '22023',
          message = 'inactive_master_data';
      end if;
      select
        slot.id, slot.code, slot.is_active, slot.starts_at, slot.ends_at,
        slot.end_day_offset, slot.sequence
      into
        existing_id, existing_name, existing_active, existing_starts_at,
        existing_ends_at, existing_end_day_offset, existing_sequence
      from public.time_slots as slot
      where slot.shift_id = resolved_shift_id
        and slot.code = master_candidate.normalized_code
        and slot.deleted_at is null;
    end if;
$dispatch_unsafe$;
  dispatch_safe constant text := $dispatch_safe$    elsif master_candidate.entity = 'downtime_reason' then
      select reason.id, reason.name, reason.is_active
      into existing_id, existing_name, existing_active
      from public.downtime_reasons as reason
      where reason.code = master_candidate.normalized_code
        and reason.deleted_at is null;
    elsif master_candidate.entity = 'time_slot' then
      select *
      into slot_definition
      from private.legacy_slot_definition(
        master_candidate.parent_code,
        master_candidate.normalized_code
      );
      if not found
        or (master_candidate.proposed_data ->> 'startsAt')::time
          is distinct from slot_definition.expected_starts_at
        or (master_candidate.proposed_data ->> 'endsAt')::time
          is distinct from slot_definition.expected_ends_at
        or (master_candidate.proposed_data ->> 'endDayOffset')::smallint
          is distinct from slot_definition.expected_end_day_offset
        or (master_candidate.proposed_data ->> 'sequence')::integer
          is distinct from slot_definition.expected_sequence then
        raise exception using
          errcode = '22023',
          message = 'invalid_time_slot';
      end if;
      select shift.id
      into resolved_shift_id
      from public.shifts as shift
      where shift.code = master_candidate.parent_code
        and shift.is_active
        and shift.deleted_at is null;
      if resolved_shift_id is null then
        raise exception using
          errcode = '22023',
          message = 'inactive_master_data';
      end if;
      select
        slot.id, slot.code, slot.is_active, slot.starts_at, slot.ends_at,
        slot.end_day_offset, slot.sequence
      into
        existing_id, existing_name, existing_active, existing_starts_at,
        existing_ends_at, existing_end_day_offset, existing_sequence
      from public.time_slots as slot
      where slot.shift_id = resolved_shift_id
        and slot.code = master_candidate.normalized_code
        and slot.deleted_at is null;
    else
      raise exception using
        errcode = '22023',
        message = 'upload_candidate_has_errors';
    end if;
$dispatch_safe$;
  status_unsafe constant text := $status_unsafe$    if master_candidate.status = 'existing' then
      if existing_id is null
        or not existing_active
        or (
          master_candidate.entity <> 'time_slot'
          and existing_name is distinct from
            master_candidate.proposed_data ->> 'proposedName'
        )
        or (
          master_candidate.entity = 'time_slot'
          and (
            existing_starts_at is distinct from
              slot_definition.expected_starts_at
            or existing_ends_at is distinct from
              slot_definition.expected_ends_at
            or existing_end_day_offset is distinct from
              slot_definition.expected_end_day_offset
            or existing_sequence is distinct from
              slot_definition.expected_sequence
          )
        ) then
        raise exception using
          errcode = '22023',
          message = 'staged_master_changed';
      end if;
    elsif master_candidate.status = 'conflict' then
      if existing_id is null or not existing_active then
        raise exception using
          errcode = '22023',
          message = 'inactive_master_data';
      end if;
      if master_candidate.entity <> 'time_slot'
        and approval ->> 'approvedName' is distinct from existing_name then
        raise exception using
          errcode = '22023',
          message = 'existing_master_name_change_forbidden';
      end if;
      if master_candidate.entity = 'time_slot'
        and (
          existing_starts_at is distinct from
            slot_definition.expected_starts_at
          or existing_ends_at is distinct from
            slot_definition.expected_ends_at
          or existing_end_day_offset is distinct from
            slot_definition.expected_end_day_offset
          or existing_sequence is distinct from
            slot_definition.expected_sequence
        ) then
        raise exception using
          errcode = '22023',
          message = 'invalid_time_slot';
      end if;
$status_unsafe$;
  status_safe constant text := $status_safe$    if master_candidate.status = 'existing' then
      if existing_id is null or not existing_active then
        raise exception using
          errcode = '22023',
          message = 'staged_master_changed';
      end if;
      if master_candidate.entity = 'time_slot' then
        if existing_starts_at is distinct from
            slot_definition.expected_starts_at
          or existing_ends_at is distinct from
            slot_definition.expected_ends_at
          or existing_end_day_offset is distinct from
            slot_definition.expected_end_day_offset
          or existing_sequence is distinct from
            slot_definition.expected_sequence then
          raise exception using
            errcode = '22023',
            message = 'staged_master_changed';
        end if;
      elsif existing_name is distinct from
          master_candidate.proposed_data ->> 'proposedName' then
        raise exception using
          errcode = '22023',
          message = 'staged_master_changed';
      end if;
    elsif master_candidate.status = 'conflict' then
      if existing_id is null or not existing_active then
        raise exception using
          errcode = '22023',
          message = 'inactive_master_data';
      end if;
      if master_candidate.entity = 'time_slot' then
        if existing_starts_at is distinct from
            slot_definition.expected_starts_at
          or existing_ends_at is distinct from
            slot_definition.expected_ends_at
          or existing_end_day_offset is distinct from
            slot_definition.expected_end_day_offset
          or existing_sequence is distinct from
            slot_definition.expected_sequence then
          raise exception using
            errcode = '22023',
            message = 'invalid_time_slot';
        end if;
      elsif approval ->> 'approvedName' is distinct from existing_name then
        raise exception using
          errcode = '22023',
          message = 'existing_master_name_change_forbidden';
      end if;
$status_safe$;
  patch_offset integer;
begin
  select replace(
    pg_get_functiondef(function_signature),
    chr(13) || chr(10),
    chr(10)
  )
  into function_definition;

  patch_offset := strpos(function_definition, dispatch_unsafe);
  if patch_offset = 0
    or strpos(
      substr(
        function_definition,
        patch_offset + length(dispatch_unsafe)
      ),
      dispatch_unsafe
    ) > 0 then
    raise exception using
      errcode = '55000',
      message = 'migration_024_dispatch_source_mismatch';
  end if;
  function_definition := replace(
    function_definition,
    dispatch_unsafe,
    dispatch_safe
  );

  patch_offset := strpos(function_definition, status_unsafe);
  if patch_offset = 0
    or strpos(
      substr(
        function_definition,
        patch_offset + length(status_unsafe)
      ),
      status_unsafe
    ) > 0 then
    raise exception using
      errcode = '55000',
      message = 'migration_024_status_source_mismatch';
  end if;
  function_definition := replace(
    function_definition,
    status_unsafe,
    status_safe
  );

  execute function_definition;

  select replace(
    pg_get_functiondef(function_signature),
    chr(13) || chr(10),
    chr(10)
  )
  into function_definition;
  if strpos(function_definition, dispatch_unsafe) > 0
    or strpos(function_definition, status_unsafe) > 0
    or strpos(function_definition, dispatch_safe) = 0
    or strpos(function_definition, status_safe) = 0 then
    raise exception using
      errcode = '55000',
      message = 'migration_024_postcondition_failed';
  end if;
end
$migration$;

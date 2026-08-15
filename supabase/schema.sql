-- cleanroom schema: policy versions + hash-chained decisions
-- (contracts: context/contracts/policy-table.md, context/contracts/ledger-row.md)

create table if not exists policy (
  version int primary key,
  ceilings jsonb not null,
  floor numeric not null,
  contextual_types jsonb not null,
  schema_descriptions jsonb not null default '{}'::jsonb,
  source text not null,
  created_at timestamptz not null default now()
);

create table if not exists decisions (
  id bigserial primary key,
  trace_id text not null,
  span_hmac text not null,
  entity_type text not null,
  confidence numeric,
  route text not null,
  disposition text,
  policy_version int references policy(version),
  model_id text,
  prompt_hash text,
  prev_hash text not null,
  row_hash text not null,
  created_at timestamptz not null default now()
);

insert into policy (version, ceilings, floor, contextual_types, schema_descriptions, source)
values (1, '{"default":0.75}'::jsonb, 0.35,
        '["username","organization","location","job_title"]'::jsonb, '{}'::jsonb, 'default')
on conflict (version) do nothing;

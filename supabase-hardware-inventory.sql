create table if not exists hardware_inventory (
  id uuid primary key default gen_random_uuid(),
  computer_name text not null unique,
  user_name text,
  domain_name text,
  manufacturer text,
  model text,
  serial_number text,
  os_caption text,
  os_version text,
  last_boot timestamptz,
  cpu_name text,
  cpu_cores int,
  cpu_logical_processors int,
  memory_total_gb numeric,
  memory_slots int,
  memory_modules jsonb default '[]'::jsonb,
  disks jsonb default '[]'::jsonb,
  volumes jsonb default '[]'::jsonb,
  battery jsonb,
  health_score int default 100,
  health_status text default 'Boa',
  warnings jsonb default '[]'::jsonb,
  raw jsonb default '{}'::jsonb,
  reported_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table hardware_inventory enable row level security;

drop policy if exists "Permitir envio inventario hardware" on hardware_inventory;
create policy "Permitir envio inventario hardware"
on hardware_inventory for insert
to anon
with check (true);

drop policy if exists "Permitir atualizar inventario hardware" on hardware_inventory;
create policy "Permitir atualizar inventario hardware"
on hardware_inventory for update
to anon
using (true)
with check (true);

drop policy if exists "Permitir visualizar inventario hardware" on hardware_inventory;
create policy "Permitir visualizar inventario hardware"
on hardware_inventory for select
to anon
using (true);

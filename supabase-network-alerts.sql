create table if not exists network_alerts (
  id uuid primary key default gen_random_uuid(),
  event_time timestamptz default now(),
  event_type text,
  severity text default 'Atencao',
  title text,
  message text,
  wan_name text,
  provider text,
  connection_status text,
  latency_ms numeric,
  packet_loss_percent numeric,
  source text default 'UniFi',
  resolved boolean default false,
  raw jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table network_alerts enable row level security;

drop policy if exists "Permitir visualizar alertas de rede" on network_alerts;
create policy "Permitir visualizar alertas de rede"
on network_alerts for select
to anon
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'network_alerts'
  ) then
    alter publication supabase_realtime add table network_alerts;
  end if;
end $$;

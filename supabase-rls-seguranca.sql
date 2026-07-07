-- =====================================================================
-- PASSO 2 - FECHAR A RLS (Central de Chamados TI - Grupo Azuos)
-- =====================================================================
-- Objetivo: parar de expor dados ao publico (chave anon) e passar a
-- exigir usuario autenticado (Supabase Auth) para LER inventario,
-- telemetria, alertas de rede e para LER/EDITAR chamados.
--
-- Rode este arquivo INTEIRO no Supabase > SQL Editor > Run.
-- Pre-requisito: ja existir pelo menos 1 usuario em Authentication > Users
-- e o login do painel ja estar funcionando (passo 1).
--
-- Politicas marcadas com "TEMP" continuam abertas de proposito e serao
-- removidas nos passos seguintes:
--   * TEMP-COLETOR  -> removida no passo 3 (proxy serverless dos coletores)
--   * TEMP-PUBLICO  -> removida no passo 4 (consulta/abertura via serverless)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funcao utilitaria: apaga TODAS as policies atuais de uma tabela.
-- Assim removemos as regras permissivas antigas sem precisar saber os nomes.
-- ---------------------------------------------------------------------
do $$
declare
  tabela text;
  p record;
  tabelas text[] := array[
    'chamados',
    'hardware_inventory',
    'hardware_live_status',
    'hardware_performance_history',
    'hardware_performance_alerts',
    'network_alerts'
  ];
begin
  foreach tabela in array tabelas loop
    if to_regclass('public.' || tabela) is not null then
      for p in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = tabela
      loop
        execute format('drop policy if exists %I on public.%I', p.policyname, tabela);
      end loop;
      execute format('alter table public.%I enable row level security', tabela);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- CHAMADOS
-- ---------------------------------------------------------------------
-- Publico pode ABRIR chamado (insert).
create policy "chamados_insert_publico"
  on public.chamados for insert
  to anon, authenticated
  with check (true);

-- TEMP-PUBLICO: leitura publica de chamados.
-- Necessaria hoje para: (1) mostrar o numero CH-xxxx apos abrir o chamado
-- (o site faz insert().select()) e (2) a consulta publica por numero.
-- Sera removida no passo 4, quando abertura/consulta passarem pelo serverless.
create policy "chamados_select_publico_TEMP"
  on public.chamados for select
  to anon
  using (true);

-- Painel do TI (autenticado): ler e atualizar status.
create policy "chamados_select_autenticado"
  on public.chamados for select
  to authenticated
  using (true);

create policy "chamados_update_autenticado"
  on public.chamados for update
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- HARDWARE_INVENTORY
-- ---------------------------------------------------------------------
-- Leitura apenas para o painel autenticado (fecha a exposicao publica).
create policy "hw_inventory_select_autenticado"
  on public.hardware_inventory for select
  to authenticated
  using (true);

-- Painel pode editar identificacao (nome, responsavel, departamento).
create policy "hw_inventory_update_autenticado"
  on public.hardware_inventory for update
  to authenticated
  using (true)
  with check (true);

-- TEMP-COLETOR: coletor ainda envia com a chave anon. Removida no passo 3.
create policy "hw_inventory_insert_coletor_TEMP"
  on public.hardware_inventory for insert
  to anon
  with check (true);

create policy "hw_inventory_update_coletor_TEMP"
  on public.hardware_inventory for update
  to anon
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- HARDWARE_LIVE_STATUS
-- ---------------------------------------------------------------------
create policy "hw_live_select_autenticado"
  on public.hardware_live_status for select
  to authenticated
  using (true);

-- TEMP-COLETOR
create policy "hw_live_insert_coletor_TEMP"
  on public.hardware_live_status for insert
  to anon
  with check (true);

create policy "hw_live_update_coletor_TEMP"
  on public.hardware_live_status for update
  to anon
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- HARDWARE_PERFORMANCE_HISTORY
-- ---------------------------------------------------------------------
create policy "hw_history_select_autenticado"
  on public.hardware_performance_history for select
  to authenticated
  using (true);

-- TEMP-COLETOR
create policy "hw_history_insert_coletor_TEMP"
  on public.hardware_performance_history for insert
  to anon
  with check (true);

-- ---------------------------------------------------------------------
-- HARDWARE_PERFORMANCE_ALERTS
-- ---------------------------------------------------------------------
create policy "hw_alerts_select_autenticado"
  on public.hardware_performance_alerts for select
  to authenticated
  using (true);

-- TEMP-COLETOR
create policy "hw_alerts_insert_coletor_TEMP"
  on public.hardware_performance_alerts for insert
  to anon
  with check (true);

create policy "hw_alerts_update_coletor_TEMP"
  on public.hardware_performance_alerts for update
  to anon
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- NETWORK_ALERTS
-- ---------------------------------------------------------------------
-- Leitura apenas para o painel autenticado.
-- Os INSERTs vem do webhook serverless usando a SERVICE KEY, que ignora
-- a RLS -> nao e preciso politica de insert para anon aqui.
create policy "network_alerts_select_autenticado"
  on public.network_alerts for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- CONFERENCIA: liste as policies resultantes.
-- Depois de rodar, verifique que so restam as regras acima.
-- ---------------------------------------------------------------------
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'chamados','hardware_inventory','hardware_live_status',
    'hardware_performance_history','hardware_performance_alerts','network_alerts'
  )
order by tablename, cmd, policyname;

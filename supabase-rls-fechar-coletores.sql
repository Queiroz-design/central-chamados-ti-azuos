-- =====================================================================
-- PASSO 3 (parte final) - FECHAR AS TABELAS DE TELEMETRIA
-- =====================================================================
-- Remove as politicas TEMP-COLETOR (que ainda deixavam a chave anon gravar).
-- A partir daqui, quem grava telemetria/inventario e SOMENTE o proxy
-- serverless, que usa a SERVICE KEY (a service key ignora a RLS).
--
-- QUANDO RODAR: depois que o proxy (api/coletor.js) estiver publicado na
-- Vercel e o COLETOR_SECRET estiver configurado. Maquinas que ainda estejam
-- com o .ps1 antigo so voltam a enviar apos se auto-atualizarem (proximo login).
-- =====================================================================

drop policy if exists "hw_inventory_insert_coletor_TEMP" on public.hardware_inventory;
drop policy if exists "hw_inventory_update_coletor_TEMP" on public.hardware_inventory;

drop policy if exists "hw_live_insert_coletor_TEMP" on public.hardware_live_status;
drop policy if exists "hw_live_update_coletor_TEMP" on public.hardware_live_status;

drop policy if exists "hw_history_insert_coletor_TEMP" on public.hardware_performance_history;

drop policy if exists "hw_alerts_insert_coletor_TEMP" on public.hardware_performance_alerts;
drop policy if exists "hw_alerts_update_coletor_TEMP" on public.hardware_performance_alerts;

-- Conferencia: nao deve sobrar nenhuma politica com "TEMP" de coletor.
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'hardware_inventory','hardware_live_status',
    'hardware_performance_history','hardware_performance_alerts'
  )
order by tablename, cmd, policyname;

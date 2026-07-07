-- =====================================================================
-- PASSO 4 (parte final) - FECHAR A TABELA "chamados" AO PUBLICO
-- =====================================================================
-- Remove as politicas que deixavam a chave anon ler/inserir chamados.
-- A partir daqui, ABRIR e CONSULTAR passam SO pela funcao serverless
-- (api/chamado.js), que usa a service key. O painel (autenticado) continua
-- lendo e atualizando normalmente.
--
-- QUANDO RODAR: depois que o novo app.js e o api/chamado.js estiverem
-- publicados e voce tiver testado abrir + consultar um chamado no site.
-- =====================================================================

-- Leitura publica da lista de chamados (a maior exposicao) - remover.
drop policy if exists "chamados_select_publico_TEMP" on public.chamados;

-- Insercao direta pela chave anon - nao e mais necessaria (vai pelo serverless).
drop policy if exists "chamados_insert_publico" on public.chamados;

-- Conferencia: em chamados devem sobrar apenas as politicas de "autenticado".
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename = 'chamados'
order by cmd, policyname;

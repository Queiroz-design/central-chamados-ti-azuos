// Endpoint publico para ABRIR (POST) e CONSULTAR (GET ?numero=) chamados,
// sem expor a tabela "chamados". Grava/le via SERVICE KEY (bypassa a RLS).
// Consulta devolve apenas UM chamado por numero e so campos seguros -
// nao ha como baixar a lista inteira.

function readRawBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

function baseSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "")
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/, "");
}

const SELECT = "id,status,nome,departamento,tipo,anydesk,prioridade,descricao,print_url,created_at";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const supabaseUrl = baseSupabaseUrl();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({ error: "Supabase nao configurado na Vercel" });
  }
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  // CONSULTA (ou diagnostico sem numero).
  if (req.method === "GET") {
    const numero = String((req.query && req.query.numero) || "");
    if (!numero) {
      return res.status(200).json({ ok: true, service: "Chamados Grupo Azuos" });
    }
    const id = parseInt(numero.replace(/\D/g, ""), 10);
    if (!id) return res.status(400).json({ error: "Numero invalido" });
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/chamados?id=eq.${id}&select=${SELECT}`, { headers });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) {
        return res.status(404).json({ error: "Chamado nao encontrado" });
      }
      return res.status(200).json({ chamado: rows[0] });
    } catch (err) {
      return res.status(502).json({ error: "Falha ao consultar", details: String(err) });
    }
  }

  // ABERTURA de chamado.
  if (req.method === "POST") {
    let body = {};
    if (req.body && typeof req.body === "object") body = req.body;
    else if (typeof req.body === "string" && req.body) { try { body = JSON.parse(req.body); } catch { body = {}; } }
    if (!body || !body.descricao) {
      const raw = await readRawBody(req);
      if (raw) { try { body = JSON.parse(raw); } catch { /* mantem */ } }
    }

    const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
    const nome = str(body.nome, 200);
    const departamento = str(body.departamento, 60);
    const tipo = str(body.tipo, 80);
    const anydesk = str(body.anydesk, 60);
    const descricao = str(body.descricao, 5000);
    const contato = str(body.contato, 120);
    const avisarWhatsapp = body.avisar_whatsapp === true;
    const prioridade = ["Alta", "Média", "Baixa"].includes(String(body.prioridade)) ? String(body.prioridade) : "Média";

    // So aceita print que veio do storage do proprio projeto.
    let printUrl = String(body.print_url || "");
    if (!printUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/chamados-prints/`)) printUrl = "";

    if (!nome || !descricao || !departamento || !tipo) {
      return res.status(400).json({ error: "Preencha nome, departamento, tipo e descricao" });
    }

    const record = { nome, departamento, tipo, anydesk, prioridade, contato: contato || null, avisar_whatsapp: avisarWhatsapp, descricao, print_url: printUrl || null, status: "Aberto" };
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/chamados`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(record),
      });
      const rows = await r.json();
      if (!r.ok) return res.status(502).json({ error: "Erro ao abrir chamado", details: rows });
      return res.status(200).json({ chamado: Array.isArray(rows) ? rows[0] : rows });
    } catch (err) {
      return res.status(502).json({ error: "Falha ao abrir chamado", details: String(err) });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Metodo nao permitido" });
};

const TOKEN = "corrigir-memoria-16gb-ddr4-2026-09-21";

function baseSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "")
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/, "");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo nao permitido" });
  }

  if (!req.query || req.query.token !== TOKEN) {
    return res.status(404).json({ error: "Nao encontrado" });
  }

  const supabaseUrl = baseSupabaseUrl();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({ error: "Supabase nao configurado" });
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  const selectUrl = `${supabaseUrl}/rest/v1/deposito_itens?select=id,nome,categoria,condicao,quantidade`;
  const selectResponse = await fetch(selectUrl, { headers });
  const items = await selectResponse.json();
  if (!selectResponse.ok) {
    return res.status(selectResponse.status).json({ error: "Falha ao listar itens", details: items });
  }

  const matches = (Array.isArray(items) ? items : []).filter((item) => {
    const name = normalize(item.nome);
    return name.includes("memoria")
      && name.includes("desktop")
      && name.includes("16gb")
      && name.includes("ddr4");
  });

  if (matches.length !== 1) {
    return res.status(409).json({
      error: "Item nao encontrado de forma unica",
      matches: matches.map((item) => ({
        id: item.id,
        nome: item.nome,
        categoria: item.categoria,
        condicao: item.condicao,
        quantidade: item.quantidade,
      })),
    });
  }

  const item = matches[0];
  const updateUrl = `${supabaseUrl}/rest/v1/deposito_itens?id=eq.${encodeURIComponent(item.id)}&select=id,nome,categoria,condicao,quantidade`;
  const updateResponse = await fetch(updateUrl, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ quantidade: 2 }),
  });
  const updated = await updateResponse.json();
  if (!updateResponse.ok) {
    return res.status(updateResponse.status).json({ error: "Falha ao atualizar item", details: updated });
  }

  return res.status(200).json({
    ok: true,
    before: item,
    after: updated[0] || null,
  });
};

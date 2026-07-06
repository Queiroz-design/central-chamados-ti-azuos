// Proxy dos coletores (Grupo Azuos).
// As maquinas enviam telemetria/inventario para ESTE endpoint com um segredo
// (COLETOR_SECRET). O proxy grava no Supabase usando a SERVICE KEY, que fica
// somente aqui no servidor (nunca no .ps1). Assim as tabelas ficam fechadas ao
// publico e a chave poderosa nao circula nas maquinas.
//
// Operacoes permitidas (allowlist) - so escrita/leitura das tabelas de telemetria:
const ALLOWED = {
  hardware_inventory: ["POST", "PATCH"],
  hardware_live_status: ["POST", "PATCH"],
  hardware_performance_history: ["POST"],
  hardware_performance_alerts: ["GET", "POST", "PATCH"],
};

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const supabaseUrl0 = process.env.SUPABASE_URL;
    const supabaseKey0 = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    // Diagnostico seguro: mostra SE as variaveis existem (nunca os valores).
    const base = {
      ok: true,
      service: "Proxy coletor Grupo Azuos",
      config: {
        hasColetorSecret: !!process.env.COLETOR_SECRET,
        hasSupabaseUrl: !!supabaseUrl0,
        hasServiceKey: !!supabaseKey0,
      },
    };
    // ?selftest=1 -> tenta falar com o Supabase usando a service key.
    if (req.query && req.query.selftest === "1") {
      if (!supabaseUrl0 || !supabaseKey0) {
        return res.status(200).json({ ...base, selftest: { skipped: "faltam variaveis" } });
      }
      try {
        const r = await fetch(`${supabaseUrl0}/rest/v1/hardware_inventory?select=computer_name&limit=0`, {
          headers: { apikey: supabaseKey0, Authorization: `Bearer ${supabaseKey0}` },
        });
        const t = await r.text();
        return res.status(200).json({
          ...base,
          selftest: { status: r.status, ok: r.ok, message: r.ok ? "service key OK" : t.slice(0, 300) },
        });
      } catch (e) {
        return res.status(200).json({ ...base, selftest: { error: String(e) } });
      }
    }
    return res.status(200).json(base);
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Metodo nao permitido" });
  }

  const configuredSecret = process.env.COLETOR_SECRET;
  if (!configuredSecret) return res.status(503).json({ error: "Proxy nao configurado (falta COLETOR_SECRET)" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: "Supabase nao configurado na Vercel" });

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const receivedSecret = req.headers["x-coletor-secret"] || body.secret;
  if (!receivedSecret || receivedSecret !== configuredSecret) {
    return res.status(401).json({ error: "Token invalido" });
  }

  const table = String(body.table || "");
  const method = String(body.method || "POST").toUpperCase();
  const query = typeof body.query === "string" ? body.query : "";
  const prefer = typeof body.prefer === "string" ? body.prefer : "";
  const payload = body.payload;

  if (!ALLOWED[table] || !ALLOWED[table].includes(method)) {
    return res.status(403).json({ error: "Operacao nao permitida", table, method });
  }
  // A query so pode conter caracteres seguros de filtro do PostgREST.
  if (query && !/^\?[A-Za-z0-9_.,=&%:*()\-]*$/.test(query)) {
    return res.status(400).json({ error: "Query invalida" });
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  const options = { method, headers };
  if (method !== "GET" && payload !== undefined) {
    options.body = JSON.stringify(payload);
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, options);
  } catch (err) {
    return res.status(502).json({ error: "Falha ao contatar o Supabase", details: String(err) });
  }

  const text = await response.text();
  res.status(response.status);
  try {
    return res.json(text ? JSON.parse(text) : {});
  } catch {
    return res.send(text);
  }
};

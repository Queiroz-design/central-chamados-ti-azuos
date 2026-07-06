module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo nao permitido" });
  }

  if (req.headers["x-cleanup-token"] !== "46b8469f-4f0d-4d72-b7dd-9b82d4738763") {
    return res.status(401).json({ error: "Token invalido" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: "Supabase nao configurado" });

  const headers = { apikey: supabaseKey, Prefer: "return=representation" };
  if (supabaseKey.startsWith("eyJ")) headers.Authorization = `Bearer ${supabaseKey}`;

  const targets = [
    ["hardware_performance_history", "id=not.is.null"],
    ["hardware_performance_alerts", "id=not.is.null"],
    ["hardware_live_status", "computer_name=not.is.null"],
    ["hardware_inventory", "id=not.is.null"],
  ];
  const deleted = {};

  for (const [table, filter] of targets) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, { method: "DELETE", headers });
    if (!response.ok) return res.status(502).json({ error: `Falha ao limpar ${table}`, details: await response.text() });
    const rows = await response.json();
    deleted[table] = rows.length;
  }

  return res.status(200).json({ ok: true, deleted });
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST" || req.headers["x-cleanup-token"] !== "d42a57fc-18ef-4d44-a51b-417bc285a482") {
    return res.status(401).json({ error: "Nao autorizado" });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Prefer: "return=representation" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const computer = "DESKTOP-UH7PHRB";
  const tables = ["hardware_performance_history", "hardware_performance_alerts", "hardware_live_status", "hardware_inventory"];
  const deleted = {};
  for (const table of tables) {
    const response = await fetch(`${url}/rest/v1/${table}?computer_name=eq.${computer}`, { method: "DELETE", headers });
    if (!response.ok) return res.status(502).json({ table, details: await response.text() });
    deleted[table] = (await response.json()).length;
  }
  return res.status(200).json({ ok: true, deleted });
};

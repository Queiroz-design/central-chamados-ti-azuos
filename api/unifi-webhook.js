function getNestedValue(value, keyPatterns, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return undefined;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (keyPatterns.some((pattern) => normalizedKey.includes(pattern))) return item;
  }

  for (const item of Object.values(value)) {
    const found = getNestedValue(item, keyPatterns, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function asNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function asText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeSeverity(body, combinedText) {
  const provided = asText(getNestedValue(body, ["severity", "level", "priority"])).toLowerCase();
  if (/critical|critica|error|down|offline|outage|failover/.test(`${provided} ${combinedText}`)) return "Critica";
  if (/warning|atencao|latency|latencia|packetloss|perdadepacotes|degraded/.test(`${provided} ${combinedText}`)) return "Atencao";
  return "Informacao";
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "UniFi webhook Grupo Azuos" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Metodo nao permitido" });
  }

  const configuredSecret = process.env.UNIFI_WEBHOOK_SECRET;
  const receivedSecret = req.query.token || req.headers["x-unifi-secret"];
  if (!configuredSecret) return res.status(503).json({ error: "Webhook ainda nao configurado" });
  if (!receivedSecret || receivedSecret !== configuredSecret) return res.status(401).json({ error: "Token invalido" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: "Supabase nao configurado na Vercel" });

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = { message: body }; }
  }

  const title = asText(getNestedValue(body, ["title", "alarmname", "eventname", "name"]), "Alerta de rede UniFi");
  const message = asText(getNestedValue(body, ["message", "description", "msg", "text"]), title);
  const eventType = asText(getNestedValue(body, ["eventtype", "alarmtype", "trigger", "type", "category"]), "internet_event");
  const combinedText = `${title} ${message} ${eventType}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const severity = normalizeSeverity(body, combinedText);
  const eventTimeValue = getNestedValue(body, ["eventtime", "timestamp", "datetime", "time"]);
  const parsedTime = eventTimeValue ? new Date(eventTimeValue) : new Date();

  const record = {
    event_time: Number.isNaN(parsedTime.getTime()) ? new Date().toISOString() : parsedTime.toISOString(),
    event_type: eventType,
    severity,
    title,
    message,
    wan_name: asText(getNestedValue(body, ["wanname", "interface", "wan"]), ""),
    provider: asText(getNestedValue(body, ["provider", "isp", "internetserviceprovider"]), ""),
    connection_status: asText(getNestedValue(body, ["connectionstatus", "status", "state"]), ""),
    latency_ms: asNumber(getNestedValue(body, ["latencyms", "latency"])),
    packet_loss_percent: asNumber(getNestedValue(body, ["packetlosspercent", "packetloss", "losspercent"])),
    source: "UniFi",
    raw: body,
  };

  const headers = {
    apikey: supabaseKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (supabaseKey.startsWith("eyJ")) headers.Authorization = `Bearer ${supabaseKey}`;

  const response = await fetch(`${supabaseUrl}/rest/v1/network_alerts`, {
    method: "POST",
    headers,
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    const details = await response.text();
    return res.status(502).json({ error: "Erro ao salvar alerta", details });
  }

  const saved = await response.json();
  return res.status(200).json({ ok: true, alert: saved[0] || record });
};

const body = document.getElementById("ticketsBody");
const filterText = document.getElementById("filterText");
const filterStatus = document.getElementById("filterStatus");
const assetsBody = document.getElementById("assetsBody");
const hardwareCards = document.getElementById("hardwareCards");
const hardwareEditModal = document.getElementById("hardwareEditModal");
const hardwareEditForm = document.getElementById("hardwareEditForm");
const hardwareDetailModal = document.getElementById("hardwareDetailModal");
const networkAlertsBody = document.getElementById("networkAlertsBody");
const chartColors = ["#0057d8", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777"];

let allTickets = [];
let hardwareAssets = [];
let hardwareLoadError = "";
let hardwareLiveStatus = [];
let performanceAlerts = [];
let performanceLoadError = "";
let selectedHardwareId = null;
let selectedHistory = [];
let networkAlerts = [];
let networkLoadError = "";

document.getElementById("btnLogout").addEventListener("click", () => {
  sessionStorage.removeItem("ti_logado");
  window.location.href = "login.html";
});

document.getElementById("btnRefresh").addEventListener("click", loadTickets);
document.getElementById("btnNetworkRefresh").addEventListener("click", loadNetworkAlerts);

document.querySelectorAll(".side-tab").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

function showTab(tabName) {
  const selectedPanel = document.getElementById(`tab-${tabName}`);
  const shouldOpen = selectedPanel && !selectedPanel.classList.contains("active");

  document.querySelectorAll(".side-tab").forEach((button) => {
    button.classList.toggle("active", shouldOpen && button.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", shouldOpen && panel.id === `tab-${tabName}`);
  });
}

function formatTicketNumber(value) {
  return "CH-" + String(value).padStart(4, "0");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isThisMonth(ticket) {
  const date = new Date(ticket.created_at);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function groupCount(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "Nao informado";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topEntries(counts, limit = 5) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

async function loadTickets() {
  body.innerHTML = '<tr><td colspan="9">Carregando chamados...</td></tr>';
  const ticketsRequest = client.from("chamados").select("*").order("created_at", { ascending: false });
  const hardwareRequest = client.from("hardware_inventory").select("*").order("reported_at", { ascending: false });
  const networkRequest = client.from("network_alerts").select("*").order("event_time", { ascending: false }).limit(100);
  const liveRequest = client.from("hardware_live_status").select("*");
  const alertsRequest = client.from("hardware_performance_alerts").select("*").order("started_at", { ascending: false }).limit(200);
  const [{ data, error }, hardwareResult, networkResult, liveResult, alertsResult] = await Promise.all([
    ticketsRequest, hardwareRequest, networkRequest, liveRequest, alertsRequest,
  ]);

  if (error) {
    body.innerHTML = `<tr><td colspan="9">Erro ao carregar chamados: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (hardwareResult.error) {
    hardwareAssets = [];
    hardwareLoadError = hardwareResult.error.message;
  } else {
    hardwareAssets = hardwareResult.data || [];
    hardwareLoadError = "";
  }

  if (networkResult.error) {
    networkAlerts = [];
    networkLoadError = networkResult.error.message;
  } else {
    networkAlerts = networkResult.data || [];
    networkLoadError = "";
  }

  if (liveResult.error || alertsResult.error) {
    hardwareLiveStatus = [];
    performanceAlerts = [];
    performanceLoadError = (liveResult.error || alertsResult.error).message;
  } else {
    hardwareLiveStatus = liveResult.data || [];
    performanceAlerts = alertsResult.data || [];
    performanceLoadError = "";
  }

  allTickets = data || [];
  renderDashboard();
  renderAssets();
  renderNetworkAlerts();
  renderTickets();
}

async function loadNetworkAlerts() {
  const { data, error } = await client.from("network_alerts").select("*").order("event_time", { ascending: false }).limit(100);
  if (error) {
    networkLoadError = error.message;
    networkAlerts = [];
  } else {
    networkLoadError = "";
    networkAlerts = data || [];
  }
  renderNetworkAlerts();
}

function buildRecurringAlerts(monthTickets) {
  const grouped = {};

  monthTickets.forEach((ticket) => {
    const user = normalizeText(ticket.nome);
    const type = normalizeText(ticket.tipo);
    if (!user || !type) return;

    const key = `${user}|${type}`;
    if (!grouped[key]) {
      grouped[key] = {
        nome: ticket.nome,
        departamento: ticket.departamento,
        tipo: ticket.tipo,
        count: 0,
      };
    }
    grouped[key].count += 1;
  });

  return Object.values(grouped)
    .filter((item) => item.count >= 3)
    .sort((a, b) => b.count - a.count);
}

function renderDashboard() {
  const monthTickets = allTickets.filter(isThisMonth);
  const openTickets = allTickets.filter((ticket) => ticket.status !== "Resolvido");
  const alerts = buildRecurringAlerts(monthTickets);

  document.getElementById("statMonth").innerText = monthTickets.length;
  document.getElementById("statOpen").innerText = openTickets.length;
  document.getElementById("statDevices").innerText = hardwareAssets.length;
  document.getElementById("statAlerts").innerText = alerts.length;

  renderAlerts(alerts);
  const typeEntries = topEntries(groupCount(monthTickets, (ticket) => ticket.tipo), 7);
  renderProblemDonut(typeEntries);
  renderBars("typeChart", typeEntries, true);
  renderBars("deptChart", topEntries(groupCount(monthTickets, (ticket) => ticket.departamento)), true);
}

function renderAlerts(alerts) {
  const alertsList = document.getElementById("alertsList");

  if (!alerts.length) {
    alertsList.innerHTML = '<div class="empty-state">Nenhuma recorrencia critica neste mes.</div>';
    return;
  }

  alertsList.innerHTML = alerts.map((alert) => `
    <article class="alert-item">
      <strong>${escapeHtml(alert.nome)} abriu ${alert.count} chamados de ${escapeHtml(alert.tipo)}</strong>
      <span>${escapeHtml(alert.departamento || "Departamento nao informado")} precisa de verificacao preventiva.</span>
    </article>
  `).join("");
}

function renderProblemDonut(entries) {
  const donut = document.getElementById("problemDonut");
  const legend = document.getElementById("problemLegend");

  if (!entries.length) {
    donut.style.background = "#e2e8f0";
    donut.innerHTML = "<strong>0</strong><span>chamados</span>";
    legend.innerHTML = '<div class="empty-state">Sem chamados neste mes.</div>';
    return;
  }

  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  let start = 0;
  const stops = entries.map((entry, index) => {
    const percent = (entry[1] / total) * 100;
    const color = chartColors[index % chartColors.length];
    const segment = `${color} ${start}% ${start + percent}%`;
    start += percent;
    return segment;
  });

  donut.style.background = `conic-gradient(${stops.join(", ")})`;
  donut.innerHTML = `<strong>${total}</strong><span>chamados</span>`;
  legend.innerHTML = entries.map(([label, count], index) => `
    <div class="legend-row">
      <i style="background:${chartColors[index % chartColors.length]}"></i>
      <span>${escapeHtml(label)}</span>
      <strong>${count}</strong>
    </div>
  `).join("");
}

function renderBars(targetId, entries, colorful = false) {
  const target = document.getElementById(targetId);

  if (!entries.length) {
    target.innerHTML = '<div class="empty-state">Sem dados neste mes.</div>';
    return;
  }

  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  target.innerHTML = entries.map(([label, count], index) => {
    const color = chartColors[index % chartColors.length];
    return `
    <div class="bar-row">
      <div class="bar-meta">
        <span>${escapeHtml(label)}</span>
        <strong>${count}</strong>
      </div>
      <div class="bar-track"><span style="width:${Math.max((count / max) * 100, 8)}%;${colorful ? `background:${color}` : ""}"></span></div>
    </div>
  `;
  }).join("");
}

function getAssetSignals(asset) {
  const user = normalizeText(asset.user_name);
  const computer = normalizeText(asset.computer_name);
  const monthTickets = allTickets.filter((ticket) => {
    const ticketText = `${normalizeText(ticket.nome)} ${normalizeText(ticket.descricao)} ${normalizeText(ticket.anydesk)}`;
    return isThisMonth(ticket) && ((user && ticketText.includes(user)) || (computer && ticketText.includes(computer)));
  });
  const byType = topEntries(groupCount(monthTickets, (ticket) => ticket.tipo), 1);

  return {
    monthCount: monthTickets.length,
    recurringType: byType.length && byType[0][1] >= 2 ? `${byType[0][0]} (${byType[0][1]})` : "-",
  };
}

function suggestedHealth(asset, monthCount) {
  if (asset.health_status === "Critica" || monthCount >= 5) return "Critica";
  if (asset.health_status === "Atencao" || monthCount >= 3) return "Atencao";
  return "Boa";
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function formatDisks(disks) {
  if (!Array.isArray(disks) || !disks.length) return "-";
  return disks.map((disk) => {
    const type = disk.media_type && disk.media_type !== "Unspecified" ? disk.media_type : "Disco";
    return `${escapeHtml(type)} ${escapeHtml(disk.size_gb || "-")} GB (${escapeHtml(disk.health_status || disk.status || "-")})`;
  }).join("<br>");
}

function formatWarnings(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return "Sem alertas de hardware.";
  return warnings.slice(0, 3).map((warning) => escapeHtml(warning.message || warning)).join("<br>");
}

function getLiveStatus(computerName) {
  return hardwareLiveStatus.find((item) => normalizeText(item.computer_name) === normalizeText(computerName));
}

function isMachineOnline(live) {
  return Boolean(live && Date.now() - new Date(live.last_seen).getTime() <= 90 * 1000);
}

function metricLevel(value) {
  const number = Number(value || 0);
  if (number >= 98) return "critical";
  if (number >= 80) return "warning";
  return "normal";
}

function liveMetric(label, value) {
  const safeValue = Math.round(Number(value || 0));
  return `<div class="hardware-live-value ${metricLevel(safeValue)}"><span>${label}</span><strong>${safeValue}%</strong></div>`;
}

function renderAssets() {
  const setupNotice = document.getElementById("performanceSetupNotice");
  setupNotice.classList.toggle("hidden", !performanceLoadError);

  if (hardwareLoadError) {
    const message = "Tabela hardware_inventory ainda nao disponivel. Rode o SQL supabase-hardware-inventory.sql no Supabase.";
    assetsBody.innerHTML = `<tr><td colspan="10">${escapeHtml(message)}</td></tr>`;
    hardwareCards.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    updateHardwareSummary();
    renderDashboard();
    return;
  }

  updateHardwareSummary();

  if (!hardwareAssets.length) {
    assetsBody.innerHTML = '<tr><td colspan="10">Nenhuma maquina enviou inventario ainda. Baixe o coletor e execute nos computadores.</td></tr>';
    hardwareCards.innerHTML = '<div class="empty-state">Aguardando primeira coleta de hardware.</div>';
    renderDashboard();
    return;
  }

  hardwareCards.innerHTML = hardwareAssets.map((asset) => {
    const signals = getAssetSignals(asset);
    const health = suggestedHealth(asset, signals.monthCount);
    const score = Number(asset.health_score || 0);
    const live = getLiveStatus(asset.computer_name);
    const online = isMachineOnline(live);

    return `
      <article class="hardware-card ${health.toLowerCase()}" onclick="openHardwareDetails('${asset.id}')">
        <div class="hardware-card-top">
          <div>
            <strong>${escapeHtml(asset.display_name || asset.computer_name)}</strong>
            <span>${escapeHtml(asset.responsible_name || asset.user_name || "-")} - ${escapeHtml(asset.model || "-")}</span>
          </div>
          <span class="health-badge ${health.toLowerCase()}">${health}</span>
        </div>
        <div class="machine-presence ${online ? "online" : "offline"}"><i></i>${online ? "Online agora" : "Offline"}</div>
        <div class="hardware-live-grid">
          ${liveMetric("CPU", live?.cpu_percent)}
          ${liveMetric("RAM", live?.memory_percent)}
          ${liveMetric("Disco", live?.disk_percent)}
        </div>
        <div class="hardware-spec">${escapeHtml(asset.cpu_name || "Processador nao informado")} | ${escapeHtml(asset.cpu_cores || 0)} nucleo(s)</div>
        <div class="health-meter"><span style="width:${Math.max(score, 4)}%"></span></div>
        <div class="hardware-score">${score}/100</div>
        <p>${online ? `Ultima leitura: ${formatDateTime(live.last_seen)}` : formatWarnings(asset.warnings)}</p>
        <button class="secondary small details-button" type="button">Ver desempenho e propriedades</button>
      </article>
    `;
  }).join("");

  assetsBody.innerHTML = hardwareAssets.map((asset) => {
    const signals = getAssetSignals(asset);
    const health = suggestedHealth(asset, signals.monthCount);

    return `
      <tr>
        <td><strong>${escapeHtml(asset.display_name || asset.computer_name)}</strong><br><span class="muted">Windows: ${escapeHtml(asset.computer_name)} | ${escapeHtml(asset.serial_number || "-")}</span></td>
        <td>${escapeHtml(asset.responsible_name || asset.user_name || "-")}<br><span class="muted">${escapeHtml(asset.department || asset.domain_name || "-")}</span></td>
        <td>${escapeHtml(asset.manufacturer || "-")}<br><span class="muted">${escapeHtml(asset.model || "-")}</span></td>
        <td>${escapeHtml(asset.cpu_name || "-")}<br><span class="muted">${escapeHtml(asset.cpu_cores || 0)} nucleo(s) / ${escapeHtml(asset.cpu_logical_processors || 0)} threads</span></td>
        <td>${escapeHtml(asset.memory_total_gb || "-")} GB<br><span class="muted">${escapeHtml(asset.memory_slots || 0)} pente(s)</span></td>
        <td>${formatDisks(asset.disks)}</td>
        <td>${signals.monthCount}</td>
        <td><span class="health-badge ${health.toLowerCase()}">${health}</span><br><span class="muted">${escapeHtml(asset.health_score || 0)}/100</span></td>
        <td>${formatDateTime(asset.reported_at)}</td>
        <td><div class="table-actions"><button class="secondary small" onclick="openHardwareDetails('${asset.id}')">Detalhes</button><button class="secondary small" onclick="event.stopPropagation();editHardware('${asset.id}')">Editar</button></div></td>
      </tr>
    `;
  }).join("");

  renderDashboard();
}

window.editHardware = function editHardware(id) {
  const asset = hardwareAssets.find((item) => item.id === id);
  if (!asset) return;

  document.getElementById("hardwareEditId").value = asset.id;
  document.getElementById("hardwareDisplayName").value = asset.display_name || "";
  document.getElementById("hardwareResponsible").value = asset.responsible_name || "";
  document.getElementById("hardwareDepartment").value = asset.department || "";
  hardwareEditModal.classList.remove("hidden");
};

function closeHardwareEdit() {
  hardwareEditModal.classList.add("hidden");
  hardwareEditForm.reset();
}

document.getElementById("btnCloseHardwareEdit").addEventListener("click", closeHardwareEdit);
hardwareEditModal.addEventListener("click", (event) => {
  if (event.target === hardwareEditModal) closeHardwareEdit();
});

hardwareEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("hardwareEditId").value;
  const changes = {
    display_name: document.getElementById("hardwareDisplayName").value.trim() || null,
    responsible_name: document.getElementById("hardwareResponsible").value.trim() || null,
    department: document.getElementById("hardwareDepartment").value.trim() || null,
  };
  const { error } = await client.from("hardware_inventory").update(changes).eq("id", id);
  if (error) {
    alert("Erro ao salvar identificacao: " + error.message);
    return;
  }
  closeHardwareEdit();
  await loadTickets();
});

function updateHardwareSummary() {
  const summary = hardwareAssets.reduce((acc, asset) => {
    const health = suggestedHealth(asset, getAssetSignals(asset).monthCount);
    acc.total += 1;
    if (health === "Boa") acc.good += 1;
    if (health === "Atencao") acc.warning += 1;
    if (health === "Critica") acc.critical += 1;
    return acc;
  }, { total: 0, good: 0, warning: 0, critical: 0 });

  document.getElementById("hwTotal").innerText = summary.total;
  document.getElementById("hwGood").innerText = summary.good;
  document.getElementById("hwWarning").innerText = summary.warning;
  document.getElementById("hwCritical").innerText = summary.critical;

  const online = hardwareLiveStatus.filter(isMachineOnline);
  document.getElementById("hwOnline").innerText = online.length;
  document.getElementById("hwActiveAlerts").innerText = performanceAlerts.filter((alert) => alert.status === "Ativo").length;
  document.getElementById("hwCpuHigh").innerText = online.filter((item) => Number(item.cpu_percent) >= 80).length;
  document.getElementById("hwMemoryHigh").innerText = online.filter((item) => Number(item.memory_percent) >= 80).length;
  document.getElementById("hwDiskHigh").innerText = online.filter((item) => Number(item.disk_percent) >= 80).length;
}

function setMetricDetail(prefix, value, cause) {
  const safeValue = Math.round(Number(value || 0));
  document.getElementById(`detail${prefix}`).innerText = `${safeValue}%`;
  const bar = document.getElementById(`detail${prefix}Bar`);
  bar.style.width = `${safeValue}%`;
  bar.className = metricLevel(safeValue);
  document.getElementById(`detail${prefix}Cause`).innerText = cause || "Sem dados recentes";
}

function renderSparkline(targetId, history, field, color) {
  const svg = document.getElementById(targetId);
  if (!history.length) {
    svg.innerHTML = '<text x="250" y="66" text-anchor="middle">Aguardando historico</text>';
    return;
  }

  const points = history.map((item, index) => {
    const x = history.length === 1 ? 250 : (index / (history.length - 1)) * 500;
    const y = 112 - (Math.min(100, Math.max(0, Number(item[field] || 0))) / 100) * 104;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  svg.innerHTML = `
    <line x1="0" y1="8" x2="500" y2="8" class="chart-limit"></line>
    <line x1="0" y1="112" x2="500" y2="112" class="chart-base"></line>
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="4" vector-effect="non-scaling-stroke"></polyline>
  `;
}

function processList(items, kind) {
  if (!Array.isArray(items) || !items.length) return '<div class="empty-state">Sem processos informados.</div>';
  return items.slice(0, 5).map((item, index) => {
    const value = kind === "cpu" ? `${Number(item.percent || 0).toFixed(1)}% CPU`
      : kind === "memory" ? `${Math.round(Number(item.memory_mb || 0))} MB`
        : `${Number(item.mbps || 0).toFixed(2)} MB/s`;
    return `<div class="process-row"><b>${index + 1}</b><span>${escapeHtml(item.name || "Processo")}</span><strong>${value}</strong></div>`;
  }).join("");
}

function formatUptime(seconds) {
  const days = Math.floor(Number(seconds || 0) / 86400);
  const hours = Math.floor((Number(seconds || 0) % 86400) / 3600);
  return `${days}d ${hours}h`;
}

function propertyItem(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
}

function describeGpu(gpu) {
  if (!Array.isArray(gpu) || !gpu.length) return "-";
  return gpu.map((item) => {
    const memory = item.memory_gb ? ` (${item.memory_gb} GB)` : "";
    return `${item.name || item.Name || "GPU"}${memory}`;
  }).join(" / ");
}

function describeMemoryModules(modules) {
  if (!Array.isArray(modules) || !modules.length) return "-";
  return modules.map((item) => `${item.size_gb || "-"} GB ${item.speed_mhz ? `@ ${item.speed_mhz} MHz` : ""}`).join(" + ");
}

function renderDeviceProperties(asset, live) {
  const disks = Array.isArray(asset.disks) ? asset.disks.map((disk) => `${disk.media_type || "Disco"} ${disk.size_gb || "-"} GB (${disk.health_status || disk.status || "-"})`).join(" / ") : "-";
  const volumes = Array.isArray(asset.volumes) ? asset.volumes.map((volume) => `${volume.drive || volume.device_id || "Volume"}: ${volume.size_gb || "-"} GB`).join(" / ") : "-";
  document.getElementById("deviceProperties").innerHTML = [
    propertyItem("Nome do dispositivo", asset.computer_name),
    propertyItem("Colaborador", asset.responsible_name || asset.user_name),
    propertyItem("Departamento", asset.department || asset.domain_name),
    propertyItem("Fabricante e modelo", `${asset.manufacturer || "-"} ${asset.model || ""}`.trim()),
    propertyItem("Processador", asset.cpu_name),
    propertyItem("Nucleos e threads", `${asset.cpu_cores || 0} nucleos / ${asset.cpu_logical_processors || 0} threads`),
    propertyItem("RAM instalada", `${asset.memory_total_gb || live?.memory_total_gb || "-"} GB`),
    propertyItem("Modulos de memoria", describeMemoryModules(asset.memory_modules)),
    propertyItem("Placa de video", describeGpu(asset.gpu)),
    propertyItem("Armazenamento", disks),
    propertyItem("Volumes", volumes),
    propertyItem("Windows", `${asset.os_caption || "-"} ${asset.os_version || ""}`.trim()),
    propertyItem("Tipo de sistema", asset.system_type || asset.os_architecture),
    propertyItem("Numero de serie", asset.serial_number),
    propertyItem("UUID do dispositivo", asset.device_uuid),
    propertyItem("ID do produto", asset.product_id),
    propertyItem("Tempo ligado", live ? formatUptime(live.uptime_seconds) : "-"),
    propertyItem("Ultima coleta de inventario", formatDateTime(asset.reported_at)),
    propertyItem("Ultima telemetria", live ? formatDateTime(live.last_seen) : "-"),
  ].join("");
}

function renderPerformanceAlerts(computerName) {
  const rows = performanceAlerts.filter((alert) => normalizeText(alert.computer_name) === normalizeText(computerName));
  const target = document.getElementById("performanceAlertsBody");
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="6">Nenhum alerta de desempenho registrado.</td></tr>';
    return;
  }
  target.innerHTML = rows.slice(0, 50).map((alert) => `
    <tr>
      <td>${formatDateTime(alert.started_at)}</td>
      <td><strong>${escapeHtml(alert.metric)}</strong></td>
      <td>${Math.round(Number(alert.peak_value || 0))}%</td>
      <td><span class="alert-status ${alert.status === "Ativo" ? "active" : "recovered"}">${escapeHtml(alert.status)}</span></td>
      <td>${escapeHtml(alert.cause_process || "Nao identificado")}</td>
      <td>${escapeHtml(alert.activity_category || "-")}</td>
    </tr>
  `).join("");
}

function renderHardwareDetails() {
  const asset = hardwareAssets.find((item) => item.id === selectedHardwareId);
  if (!asset) return;
  const live = getLiveStatus(asset.computer_name);
  const online = isMachineOnline(live);
  const activeAlert = performanceAlerts.find((alert) => alert.computer_name === asset.computer_name && alert.status === "Ativo");

  document.getElementById("deviceDetailTitle").innerText = asset.display_name || asset.computer_name;
  document.getElementById("deviceDetailSubtitle").innerText = `${asset.responsible_name || asset.user_name || "Sem responsavel"} | ${asset.manufacturer || ""} ${asset.model || ""}`;
  const liveBadge = document.getElementById("deviceLiveStatus");
  liveBadge.className = `device-live-status ${online ? "online" : "offline"}`;
  liveBadge.innerText = online ? "Online - atualizacao a cada 30 segundos" : "Offline ou sem agente ativo";

  const activity = live?.activity_category || "Atividade nao identificada";
  setMetricDetail("Cpu", live?.cpu_percent, live?.top_cpu?.[0] ? `Maior consumo: ${live.top_cpu[0].name}` : "Sem processo dominante");
  setMetricDetail("Memory", live?.memory_percent, live?.top_memory?.[0] ? `Maior consumo: ${live.top_memory[0].name}` : "Sem processo dominante");
  setMetricDetail("Disk", live?.disk_percent, live?.top_io?.[0] ? `Maior E/S: ${live.top_io[0].name}` : "Sem processo dominante");
  document.getElementById("detailTopProcesses").innerHTML = `
    <h4>CPU</h4>${processList(live?.top_cpu, "cpu")}
    <h4>Memoria</h4>${processList(live?.top_memory, "memory")}
    <h4>Disco</h4>${processList(live?.top_io, "io")}
  `;
  document.getElementById("detailActivity").innerHTML = `
    <span>Aplicativo em primeiro plano</span><strong>${escapeHtml(live?.active_process || "Nao identificado")}</strong>
    <span>Categoria observada</span><strong>${escapeHtml(activity)}</strong>
    ${activeAlert ? `<div class="active-cause"><b>Alerta ativo:</b> ${escapeHtml(activeAlert.message || activeAlert.metric)}</div>` : ""}
    <small>O sistema registra o aplicativo e a categoria, sem capturar URL, texto ou conteudo do usuario.</small>
  `;
  renderSparkline("cpuHistoryChart", selectedHistory, "cpu_percent", "#38bdf8");
  renderSparkline("memoryHistoryChart", selectedHistory, "memory_percent", "#a78bfa");
  renderSparkline("diskHistoryChart", selectedHistory, "disk_percent", "#f59e0b");
  renderDeviceProperties(asset, live);
  renderPerformanceAlerts(asset.computer_name);
}

window.openHardwareDetails = async function openHardwareDetails(id) {
  const asset = hardwareAssets.find((item) => item.id === id);
  if (!asset) return;
  selectedHardwareId = id;
  selectedHistory = [];
  hardwareDetailModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  renderHardwareDetails();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client.from("hardware_performance_history")
    .select("*")
    .eq("computer_name", asset.computer_name)
    .gte("sampled_at", since)
    .order("sampled_at", { ascending: true })
    .limit(300);
  if (selectedHardwareId !== id) return;
  selectedHistory = data || [];
  renderHardwareDetails();
};

function closeHardwareDetails() {
  hardwareDetailModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  selectedHardwareId = null;
  selectedHistory = [];
}

document.getElementById("btnCloseHardwareDetail").addEventListener("click", closeHardwareDetails);
hardwareDetailModal.addEventListener("click", (event) => {
  if (event.target === hardwareDetailModal) closeHardwareDetails();
});

function isNetworkRecovery(alert) {
  const text = `${alert.title || ""} ${alert.message || ""} ${alert.connection_status || ""}`.toLowerCase();
  return /recovered|restored|online|connected|healthy|recuperad|restabelecid|normalizad/.test(text);
}

function networkSeverityClass(severity) {
  if (severity === "Critica") return "critical";
  if (severity === "Atencao") return "warning";
  return "info";
}

function renderNetworkAlerts() {
  const statusElement = document.getElementById("networkStatus");
  const banner = document.getElementById("networkHealthBanner");
  const badge = document.getElementById("networkBadge");

  if (networkLoadError) {
    networkAlertsBody.innerHTML = '<tr><td colspan="6">Tabela network_alerts ainda nao disponivel. Rode o SQL supabase-network-alerts.sql no Supabase.</td></tr>';
    statusElement.innerText = "Nao configurado";
    banner.className = "network-health-banner warning";
    banner.innerText = "O monitoramento ainda precisa ser configurado.";
    badge.classList.add("hidden");
    return;
  }

  const now = Date.now();
  const last24Hours = networkAlerts.filter((alert) => now - new Date(alert.event_time).getTime() <= 24 * 60 * 60 * 1000);
  const criticalCount = last24Hours.filter((alert) => alert.severity === "Critica" && !isNetworkRecovery(alert)).length;
  const latest = networkAlerts[0];
  const latestAgeMinutes = latest ? (now - new Date(latest.event_time).getTime()) / 60000 : Infinity;
  const activeIssue = latest && latestAgeMinutes <= 30 && !isNetworkRecovery(latest) && ["Critica", "Atencao"].includes(latest.severity);

  document.getElementById("network24h").innerText = last24Hours.length;
  document.getElementById("networkCritical").innerText = criticalCount;
  document.getElementById("networkLastEvent").innerText = latest ? formatDateTime(latest.event_time) : "-";

  if (activeIssue) {
    const critical = latest.severity === "Critica";
    statusElement.innerText = critical ? "Oscilacao" : "Atencao";
    banner.className = `network-health-banner ${critical ? "critical" : "warning"}`;
    banner.innerText = `${latest.title || "Problema de internet"}: ${latest.message || "Verifique o UniFi."}`;
  } else {
    statusElement.innerText = networkAlerts.length ? "Estavel" : "Sem eventos";
    banner.className = "network-health-banner stable";
    banner.innerText = networkAlerts.length ? "Nenhuma oscilacao ativa detectada nos ultimos 30 minutos." : "Aguardando o primeiro evento do UniFi.";
  }

  if (criticalCount > 0) {
    badge.innerText = criticalCount > 99 ? "99+" : criticalCount;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  if (!networkAlerts.length) {
    networkAlertsBody.innerHTML = '<tr><td colspan="6">Nenhum alerta recebido do UniFi ainda.</td></tr>';
    return;
  }

  networkAlertsBody.innerHTML = networkAlerts.map((alert) => {
    const severityClass = networkSeverityClass(alert.severity);
    const metrics = [
      alert.latency_ms !== null && alert.latency_ms !== undefined ? `${alert.latency_ms} ms` : "",
      alert.packet_loss_percent !== null && alert.packet_loss_percent !== undefined ? `${alert.packet_loss_percent}% perda` : "",
    ].filter(Boolean).join(" / ") || "-";
    const wan = [alert.wan_name, alert.provider].filter(Boolean).join(" / ") || "-";

    return `
      <tr>
        <td>${formatDateTime(alert.event_time)}</td>
        <td><span class="network-severity ${severityClass}">${escapeHtml(alert.severity || "Informacao")}</span></td>
        <td><strong>${escapeHtml(alert.title || alert.event_type || "Evento UniFi")}</strong></td>
        <td>${escapeHtml(wan)}</td>
        <td>${escapeHtml(metrics)}</td>
        <td>${escapeHtml(alert.message || "-")}</td>
      </tr>
    `;
  }).join("");
}

function renderTickets() {
  const text = filterText.value.toLowerCase();
  const status = filterStatus.value;
  const filtered = allTickets.filter((ticket) => {
    const content = JSON.stringify(ticket).toLowerCase() + " " + formatTicketNumber(ticket.id).toLowerCase();
    return content.includes(text) && (!status || ticket.status === status);
  });

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="9">Nenhum chamado encontrado.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map((ticket) => `
    <tr>
      <td><strong>${formatTicketNumber(ticket.id)}</strong></td>
      <td>${new Date(ticket.created_at).toLocaleString("pt-BR")}</td>
      <td>${escapeHtml(ticket.nome)}</td>
      <td>${escapeHtml(ticket.departamento)}</td>
      <td>${escapeHtml(ticket.tipo)}</td>
      <td>${escapeHtml(ticket.anydesk || "-")}</td>
      <td>
        <select class="status" onchange="changeStatus(${ticket.id}, this.value)">
          <option ${ticket.status === "Aberto" ? "selected" : ""}>Aberto</option>
          <option ${ticket.status === "Em atendimento" ? "selected" : ""}>Em atendimento</option>
          <option ${ticket.status === "Resolvido" ? "selected" : ""}>Resolvido</option>
        </select>
      </td>
      <td>${escapeHtml(ticket.descricao)}</td>
      <td>${ticket.print_url ? `<a href="${escapeHtml(ticket.print_url)}" target="_blank"><img class="print-img" src="${escapeHtml(ticket.print_url)}" alt="Print do chamado"></a>` : "-"}</td>
    </tr>
  `).join("");
}

window.changeStatus = async function changeStatus(id, status) {
  const { error } = await client.from("chamados").update({ status }).eq("id", id);

  if (error) {
    alert("Erro ao alterar status: " + error.message);
    return;
  }

  await loadTickets();
};

filterText.addEventListener("input", renderTickets);
filterStatus.addEventListener("change", renderTickets);

document.getElementById("btnExport").addEventListener("click", () => {
  const header = ["Chamado", "Data", "Nome", "Departamento", "Tipo", "AnyDesk", "Status", "Descricao", "Print"];
  const rows = allTickets.map((ticket) => [
    formatTicketNumber(ticket.id),
    new Date(ticket.created_at).toLocaleString("pt-BR"),
    ticket.nome,
    ticket.departamento,
    ticket.tipo,
    ticket.anydesk,
    ticket.status,
    ticket.descricao,
    ticket.print_url,
  ]);
  const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "chamados-ti.csv";
  link.click();
});

client
  .channel("network-alerts-live")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "network_alerts" }, (payload) => {
    networkAlerts = [payload.new, ...networkAlerts.filter((alert) => alert.id !== payload.new.id)].slice(0, 100);
    networkLoadError = "";
    renderNetworkAlerts();
  })
  .subscribe();

client
  .channel("hardware-performance-live")
  .on("postgres_changes", { event: "*", schema: "public", table: "hardware_live_status" }, (payload) => {
    const current = payload.new;
    if (!current?.computer_name) return;
    hardwareLiveStatus = [current, ...hardwareLiveStatus.filter((item) => item.computer_name !== current.computer_name)];
    performanceLoadError = "";
    renderAssets();
    if (selectedHardwareId) renderHardwareDetails();
  })
  .on("postgres_changes", { event: "*", schema: "public", table: "hardware_performance_alerts" }, (payload) => {
    const current = payload.new;
    if (!current?.id) return;
    performanceAlerts = [current, ...performanceAlerts.filter((item) => item.id !== current.id)]
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
      .slice(0, 200);
    performanceLoadError = "";
    updateHardwareSummary();
    if (selectedHardwareId) renderHardwareDetails();
  })
  .subscribe();

loadTickets();

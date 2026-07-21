const body = document.getElementById("ticketsBody");
const filterText = document.getElementById("filterText");
const filterStatus = document.getElementById("filterStatus");
const assetsBody = document.getElementById("assetsBody");
const hardwareCards = document.getElementById("hardwareCards");
const hardwareDepartmentFilter = document.getElementById("hardwareDepartmentFilter");
const hardwareEditModal = document.getElementById("hardwareEditModal");
const hardwareEditForm = document.getElementById("hardwareEditForm");
const hardwareDetailModal = document.getElementById("hardwareDetailModal");
const networkAlertsBody = document.getElementById("networkAlertsBody");
const ticketDetailModal = document.getElementById("ticketDetailModal");
const chartColors = ["#f59e0b", "#10b981", "#a855f7", "#ec4899", "#ef4444", "#eab308", "#14b8a6"];
const companyDepartments = [
  "ANALYZE", "CERTIFICADO", "COMERCIAL", "CONT\u00c1BIL", "CS", "FINANCEIRO",
  "FISCAL", "PARALEGAL", "PESSOAL", "RECEP\u00c7\u00c3O", "RH",
];

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
let ticketsPage = 1;
const TICKETS_PER_PAGE = 25;
let signalsCache = new Map();
let assetsRenderTimer = null;
let hardwareView = "cards";
let hardwareSort = { key: "nome", dir: "asc" };
let hardwareHealthFilter = "";
let hardwareLiveFilter = "";

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// Agrupa varias telemetrias que chegam juntas em uma unica re-renderizacao.
function scheduleRenderAssets() {
  if (assetsRenderTimer) return;
  assetsRenderTimer = setTimeout(() => {
    assetsRenderTimer = null;
    renderAssets();
  }, 600);
}

document.getElementById("btnLogout").addEventListener("click", async () => {
  await client.auth.signOut();
  window.location.replace("login.html");
});

document.getElementById("btnRefresh").addEventListener("click", loadTickets);
document.getElementById("btnNetworkRefresh").addEventListener("click", loadNetworkAlerts);

document.querySelectorAll(".side-tab").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});

document.getElementById("btnToggleSidebar")?.addEventListener("click", () => {
  document.querySelector(".admin-sidebar").classList.toggle("collapsed");
});

// Filtros clicaveis: caixas de saude e caixas de estado ao vivo (um por vez).
function updateFilterActiveClasses() {
  document.querySelectorAll(".health-filter").forEach((b) => b.classList.toggle("active", b.dataset.health === hardwareHealthFilter && hardwareHealthFilter !== ""));
  document.querySelectorAll(".live-filter").forEach((b) => b.classList.toggle("active", b.dataset.live === hardwareLiveFilter && hardwareLiveFilter !== ""));
}

document.querySelectorAll(".health-filter").forEach((box) => {
  box.addEventListener("click", () => {
    const h = box.dataset.health;
    hardwareHealthFilter = (h === "all" || hardwareHealthFilter === h) ? "" : h;
    hardwareLiveFilter = "";
    updateFilterActiveClasses();
    renderAssets();
    document.getElementById("hardwareCards")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
});

document.querySelectorAll(".live-filter").forEach((box) => {
  box.addEventListener("click", () => {
    const v = box.dataset.live;
    hardwareLiveFilter = hardwareLiveFilter === v ? "" : v;
    hardwareHealthFilter = "";
    updateFilterActiveClasses();
    renderAssets();
    document.getElementById("hardwareCards")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
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

// Abre uma aba de forma direta (usado pelos quadros clicaveis).
window.irParaAba = function irParaAba(tabName) {
  document.querySelectorAll(".side-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tabName}`));
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// Escopo do dashboard: qual conjunto de chamados alimenta o mapa/graficos.
let dashScope = "mes";
window.setDashScope = function setDashScope(scope) {
  dashScope = dashScope === scope ? "mes" : scope;
  renderDashboard();
};

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

// Exibe rotulos com acento sem alterar os valores usados na logica/banco.
function accentLabel(value) {
  const map = { Atencao: "Atenção", Critica: "Crítica", Informacao: "Informação" };
  return map[value] || value;
}

// Tempo relativo amigavel ("há 8 min", "há 3 h", "há 2 dia(s)").
function relativeTime(value) {
  const then = new Date(value).getTime();
  if (!then) return "-";
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `há ${days} dia(s)`;
  return new Date(value).toLocaleDateString("pt-BR");
}

function priorityLabel(value) {
  const p = normalizeText(value);
  if (p === "alta") return "Alta";
  if (p === "baixa") return "Baixa";
  return "Média";
}

function statusSlug(value) {
  const s = normalizeText(value);
  if (s === "resolvido") return "resolvido";
  if (s === "em atendimento") return "atendimento";
  return "aberto";
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
    hardwareAssets = (hardwareResult.data || []).filter((asset) => !asset.arquivado);
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

  allTickets = (data || []).map((ticket) => ({
    ...ticket,
    _search: [
      formatTicketNumber(ticket.id), ticket.nome, ticket.departamento,
      ticket.tipo, ticket.anydesk, ticket.descricao, ticket.status,
      ticket.prioridade, ticket.contato, ticket.responsavel,
    ].map((value) => String(value || "")).join(" ").toLowerCase(),
  }));
  signalsCache.clear();
  populateHardwareDepartmentFilter();
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

// Maquinas com muita manutencao (3+ registros) = alerta de atencao.
function getManutencaoAlertas(minCount = 3) {
  const byMachine = {};
  (manutencoes || []).forEach((m) => {
    const key = m.computer_name || m.computer_label || "Sem identificação";
    const label = `${m.computer_label || m.computer_name || "Sem identificação"}${m.computer_department ? " — " + m.computer_department : ""}`;
    if (!byMachine[key]) byMachine[key] = { key, label, total: 0 };
    byMachine[key].total += 1;
  });
  return Object.values(byMachine).filter((c) => c.total >= minCount).sort((a, b) => b.total - a.total);
}

function renderDashboard() {
  const monthTickets = allTickets.filter(isThisMonth);
  const openTickets = allTickets.filter((ticket) => ticket.status !== "Resolvido");
  const alerts = buildRecurringAlerts(monthTickets);
  const machineAlerts = getManutencaoAlertas(3);

  document.getElementById("statMonth").innerText = monthTickets.length;
  document.getElementById("statOpen").innerText = openTickets.length;
  document.getElementById("statDevices").innerText = hardwareAssets.length;
  document.getElementById("statAlerts").innerText = alerts.length + machineAlerts.length;

  // O mapa e os graficos respondem ao quadro selecionado (mes / abertos / recorrencia).
  const recurringSet = new Set();
  alerts.forEach((a) => monthTickets.forEach((t) => { if (t.nome === a.nome && t.tipo === a.tipo) recurringSet.add(t); }));
  let scoped = monthTickets;
  if (dashScope === "abertos") scoped = openTickets;
  else if (dashScope === "recorrencia") scoped = [...recurringSet];

  document.querySelectorAll(".dash-filter").forEach((b) => b.classList.toggle("active", b.dataset.scope === dashScope && dashScope !== "mes"));

  renderAlerts(alerts, machineAlerts);
  const typeEntries = topEntries(groupCount(scoped, (ticket) => ticket.tipo), 7);
  renderProblemDonut(typeEntries);
  renderBars("typeChart", typeEntries, true);
  renderBars("deptChart", topEntries(groupCount(scoped, (ticket) => ticket.departamento)), true);
}

function renderAlerts(alerts, machineAlerts = []) {
  const alertsList = document.getElementById("alertsList");

  if (!alerts.length && !machineAlerts.length) {
    alertsList.innerHTML = '<div class="empty-state">Nenhum alerta neste mês.</div>';
    return;
  }

  const ticketHtml = alerts.map((alert) => `
    <article class="alert-item">
      <strong>${escapeHtml(alert.nome)} abriu ${alert.count} chamados de ${escapeHtml(alert.tipo)}</strong>
      <span>${escapeHtml(alert.departamento || "Departamento não informado")} precisa de verificação preventiva.</span>
    </article>
  `).join("");

  const machineHtml = machineAlerts.map((c) => `
    <article class="alert-item alert-machine">
      <strong>🔧 ${escapeHtml(c.label)} — ${c.total} manutenções</strong>
      <span>Máquina com muita manutenção. Avalie se ainda compensa mantê-la na operação.</span>
    </article>
  `).join("");

  alertsList.innerHTML = ticketHtml + machineHtml;
}

function renderProblemDonut(entries) {
  const donut = document.getElementById("problemDonut");
  const legend = document.getElementById("problemLegend");

  if (!entries.length) {
    donut.style.background = "#e2e8f0";
    donut.innerHTML = "<strong>0</strong><span>chamados</span>";
    legend.innerHTML = '<div class="empty-state">Sem chamados neste mês.</div>';
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
    target.innerHTML = '<div class="empty-state">Sem dados neste mês.</div>';
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

function getAssetMonthTickets(asset) {
  const users = [asset.user_name, asset.responsible_name, asset.display_name].map(normalizeText).filter(Boolean);
  const computer = normalizeText(asset.computer_name);
  return allTickets.filter((ticket) => {
    const ticketText = `${normalizeText(ticket.nome)} ${normalizeText(ticket.descricao)} ${normalizeText(ticket.anydesk)}`;
    return isThisMonth(ticket) && (users.some((user) => ticketText.includes(user)) || (computer && ticketText.includes(computer)));
  });
}

function getAssetSignals(asset) {
  if (signalsCache.has(asset.id)) return signalsCache.get(asset.id);
  const monthTickets = getAssetMonthTickets(asset);
  const byType = topEntries(groupCount(monthTickets, (ticket) => ticket.tipo), 1);
  const result = {
    monthCount: monthTickets.length,
    recurringType: byType.length && byType[0][1] >= 2 ? `${byType[0][0]} (${byType[0][1]})` : "-",
  };
  signalsCache.set(asset.id, result);
  return result;
}

function getAssetDepartment(asset) {
  return String(asset.department || "Sem departamento").trim();
}

function populateHardwareDepartmentFilter() {
  const selected = hardwareDepartmentFilter.value;
  const assignedDepartments = hardwareAssets.map(getAssetDepartment).filter((department) => department !== "Sem departamento");
  const departments = [...new Set([...companyDepartments, ...assignedDepartments])]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (hardwareAssets.some((asset) => getAssetDepartment(asset) === "Sem departamento")) departments.push("Sem departamento");
  hardwareDepartmentFilter.innerHTML = '<option value="">Todos os departamentos</option>' + departments
    .map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`)
    .join("");
  if (departments.includes(selected)) hardwareDepartmentFilter.value = selected;
}

function populateHardwareEditDepartment() {
  const target = document.getElementById("hardwareDepartment");
  target.innerHTML = '<option value="">Selecione o departamento</option>' + companyDepartments
    .map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`)
    .join("");
}

function getNextComputerLabel() {
  const numbers = hardwareAssets.map((asset) => {
    const match = String(asset.display_name || "").match(/^computador\s*0*(\d+)$/i);
    return match ? Number(match[1]) : 0;
  });
  const next = Math.max(0, ...numbers) + 1;
  return `Computador ${String(next).padStart(2, "0")}`;
}

function assetSortValue(asset, key) {
  if (key === "departamento") return normalizeText(getAssetDepartment(asset));
  if (key === "memoria") return Number(asset.memory_total_gb || 0);
  if (key === "chamados") return getAssetSignals(asset).monthCount;
  if (key === "integridade") {
    const rank = { Boa: 1, Atencao: 2, Critica: 3 };
    return rank[suggestedHealth(asset, getAssetSignals(asset).monthCount)] || 0;
  }
  if (key === "coleta") return new Date(asset.reported_at || 0).getTime();
  return normalizeText(asset.display_name || asset.computer_name);
}

let hardwareTypeFilter = ""; // "", "computador", "notebook"
function getAssetType(asset) {
  const label = String(asset.display_name || asset.computer_name || "");
  return /notebook/i.test(label) ? "notebook" : "computador";
}
function getAssetNumber(asset) {
  const m = String(asset.display_name || asset.computer_name || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 999999;
}

function getFilteredHardwareAssets() {
  const department = normalizeText(hardwareDepartmentFilter.value);
  const searchInput = document.getElementById("hardwareSearch");
  const search = normalizeText(searchInput ? searchInput.value : "");
  let list = department
    ? hardwareAssets.filter((asset) => normalizeText(getAssetDepartment(asset)) === department)
    : hardwareAssets.slice();
  if (hardwareTypeFilter) list = list.filter((asset) => getAssetType(asset) === hardwareTypeFilter);
  if (search) {
    list = list.filter((asset) =>
      `${asset.display_name || ""} ${asset.computer_name || ""} ${getAssetDepartment(asset)} ${asset.model || ""} ${asset.cpu_name || ""} ${asset.manufacturer || ""}`
        .toLowerCase().includes(search)
    );
  }
  const dir = hardwareSort.dir === "desc" ? -1 : 1;
  if (hardwareSort.key === "nome") {
    // Ordena por NUMERO (Computador 01 e Notebook 01 juntos), depois computador antes de notebook.
    list.sort((a, b) => {
      const na = getAssetNumber(a), nb = getAssetNumber(b);
      if (na !== nb) return (na - nb) * dir;
      const ta = getAssetType(a), tb = getAssetType(b);
      if (ta !== tb) return (ta === "computador" ? -1 : 1) * dir;
      return String(a.display_name || a.computer_name).localeCompare(String(b.display_name || b.computer_name), "pt-BR", { numeric: true }) * dir;
    });
  } else {
    list.sort((a, b) => {
      const va = assetSortValue(a, hardwareSort.key);
      const vb = assetSortValue(b, hardwareSort.key);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * dir;
    });
  }
  return list;
}

function applyHardwareView() {
  const cardsEl = document.getElementById("hardwareCards");
  const tableEl = document.getElementById("hardwareTableWrap");
  if (cardsEl) cardsEl.style.display = hardwareView === "table" ? "none" : "";
  if (tableEl) tableEl.style.display = hardwareView === "table" ? "" : "none";
  document.getElementById("btnViewCards")?.classList.toggle("active", hardwareView !== "table");
  document.getElementById("btnViewTable")?.classList.toggle("active", hardwareView === "table");
  document.querySelectorAll(".assets-table th.sortable").forEach((th) => {
    const arrow = th.querySelector(".arrow");
    if (arrow) arrow.textContent = th.dataset.sort === hardwareSort.key ? (hardwareSort.dir === "asc" ? "▲" : "▼") : "";
  });
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
  return Boolean(live && Date.now() - new Date(live.last_seen).getTime() <= 150 * 1000);
}

function assetMatchesLive(asset, filter) {
  const live = getLiveStatus(asset.computer_name);
  const online = isMachineOnline(live);
  if (filter === "online") return online;
  if (filter === "offline") return !online;
  if (filter === "alertas") {
    return performanceAlerts.some((a) => normalizeText(a.computer_name) === normalizeText(asset.computer_name) && a.status === "Ativo");
  }
  if (filter === "cpu") return online && Number(live.cpu_percent || 0) >= 80;
  if (filter === "memoria") return online && Number(live.memory_percent || 0) >= 80;
  if (filter === "disco") return online && Number(live.disk_percent || 0) >= 80;
  return true;
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
  signalsCache.clear();
  applyHardwareView();
  const setupNotice = document.getElementById("performanceSetupNotice");
  setupNotice.classList.toggle("hidden", !performanceLoadError);

  if (hardwareLoadError) {
    const message = "Tabela hardware_inventory ainda não disponível. Rode o SQL supabase-hardware-inventory.sql no Supabase.";
    assetsBody.innerHTML = `<tr><td colspan="10">${escapeHtml(message)}</td></tr>`;
    hardwareCards.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    updateHardwareSummary();
    renderDashboard();
    return;
  }

  const filteredAssets = getFilteredHardwareAssets();
  updateHardwareSummary(filteredAssets);

  let displayAssets = filteredAssets;
  if (hardwareHealthFilter) {
    displayAssets = filteredAssets.filter((asset) => suggestedHealth(asset, getAssetSignals(asset).monthCount) === hardwareHealthFilter);
  } else if (hardwareLiveFilter) {
    displayAssets = filteredAssets.filter((asset) => assetMatchesLive(asset, hardwareLiveFilter));
  }

  if (!hardwareAssets.length) {
    assetsBody.innerHTML = '<tr><td colspan="10">Nenhuma máquina enviou inventário ainda. Baixe o coletor e execute nos computadores.</td></tr>';
    hardwareCards.innerHTML = '<div class="empty-state">Aguardando primeira coleta de hardware.</div>';
    renderDashboard();
    return;
  }

  if (!displayAssets.length) {
    assetsBody.innerHTML = '<tr><td colspan="10">Nenhuma máquina neste filtro.</td></tr>';
    hardwareCards.innerHTML = '<div class="empty-state">Nenhuma máquina neste filtro.</div>';
    return;
  }

  hardwareCards.innerHTML = displayAssets.map((asset) => {
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
            <span>${escapeHtml(getAssetDepartment(asset))} - ${escapeHtml(asset.responsible_name || asset.model || "-")}</span>
          </div>
          <span class="health-badge ${health.toLowerCase()}">${accentLabel(health)}</span>
        </div>
        <div class="machine-presence ${online ? "online" : "offline"}"><i></i>${online ? "Online agora" : "Offline"}</div>
        <div class="hardware-live-grid">
          ${liveMetric("CPU", live?.cpu_percent)}
          ${liveMetric("RAM", live?.memory_percent)}
          ${liveMetric("Disco", live?.disk_percent)}
        </div>
        <div class="hardware-spec">${escapeHtml(asset.cpu_name || "Processador não informado")} | ${escapeHtml(asset.cpu_cores || 0)} núcleo(s)</div>
        <div class="health-meter"><span style="width:${Math.max(score, 4)}%"></span></div>
        <div class="hardware-score">${score}/100</div>
        <p>${online ? `Última leitura: ${formatDateTime(live.last_seen)}` : formatWarnings(asset.warnings)}</p>
        <button class="secondary small details-button" type="button">Ver desempenho e propriedades</button>
      </article>
    `;
  }).join("");

  assetsBody.innerHTML = displayAssets.map((asset) => {
    const signals = getAssetSignals(asset);
    const health = suggestedHealth(asset, signals.monthCount);

    return `
      <tr>
        <td><strong>${escapeHtml(asset.display_name || asset.computer_name)}</strong><br><span class="muted">Windows: ${escapeHtml(asset.computer_name)} | ${escapeHtml(asset.serial_number || "-")}</span></td>
        <td><strong>${escapeHtml(getAssetDepartment(asset))}</strong><br><span class="muted">${escapeHtml(asset.responsible_name || "Sem responsável fixo")}</span></td>
        <td>${escapeHtml(asset.manufacturer || "-")}<br><span class="muted">${escapeHtml(asset.model || "-")}</span></td>
        <td>${escapeHtml(asset.cpu_name || "-")}<br><span class="muted">${escapeHtml(asset.cpu_cores || 0)} núcleo(s) / ${escapeHtml(asset.cpu_logical_processors || 0)} threads</span></td>
        <td>${escapeHtml(asset.memory_total_gb || "-")} GB<br><span class="muted">${escapeHtml(asset.memory_slots || 0)} pente(s)</span></td>
        <td>${formatDisks(asset.disks)}</td>
        <td>${signals.monthCount}</td>
        <td><span class="health-badge ${health.toLowerCase()}">${accentLabel(health)}</span><br><span class="muted">${escapeHtml(asset.health_score || 0)}/100</span></td>
        <td>${formatDateTime(asset.reported_at)}</td>
        <td><div class="table-actions"><button class="secondary small" onclick="openHardwareDetails('${asset.id}')">Detalhes</button><button class="secondary small" onclick="event.stopPropagation();editHardware('${asset.id}')">Editar</button><button class="secondary small remove-hw" onclick="event.stopPropagation();archiveHardware('${asset.id}')">Remover</button><button class="secondary small remove-hw" onclick="event.stopPropagation();blockHardware('${asset.id}')" title="Bloquear (rejeitar os dados desta máquina)">Bloquear</button></div></td>
      </tr>
    `;
  }).join("");

  renderDashboard();
}

window.editHardware = function editHardware(id) {
  const asset = hardwareAssets.find((item) => item.id === id);
  if (!asset) return;

  document.getElementById("hardwareEditId").value = asset.id;
  document.getElementById("hardwareDisplayName").value = asset.display_name || getNextComputerLabel();
  document.getElementById("hardwareResponsible").value = asset.responsible_name || "";
  document.getElementById("hardwareDepartment").value = asset.department || "";
  hardwareEditModal.classList.remove("hidden");
};

window.archiveHardware = async function archiveHardware(id) {
  const asset = hardwareAssets.find((item) => item.id === id);
  const label = asset ? (asset.display_name || asset.computer_name) : "esta máquina";
  if (!confirm(`Remover ${label} do inventário?\n\nA máquina some do painel, mas os dados ficam guardados no banco (dá para restaurar).`)) return;
  const { error } = await client.from("hardware_inventory").update({ arquivado: true }).eq("id", id);
  if (error) {
    alert("Erro ao remover: " + error.message);
    return;
  }
  await loadTickets();
};

window.blockHardware = async function blockHardware(id) {
  const asset = hardwareAssets.find((item) => item.id === id);
  if (!asset) return;
  const name = asset.computer_name;
  const label = asset.display_name || name;
  if (!confirm(`Bloquear a máquina "${label}" (${name})?\n\nEla some do painel E o sistema passa a REJEITAR os dados dela. Use para máquinas desconhecidas ou não autorizadas.`)) return;
  const { error } = await client.from("coletores_bloqueados").insert({ computer_name: name, motivo: "Bloqueada pelo painel" });
  if (error && !String(error.message).toLowerCase().includes("duplicate")) {
    alert("Erro ao bloquear: " + error.message);
    return;
  }
  await client.from("hardware_inventory").update({ arquivado: true }).eq("id", id);
  await loadTickets();
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
    alert("Erro ao salvar identificação: " + error.message);
    return;
  }
  closeHardwareEdit();
  await loadTickets();
});

function updateHardwareSummary(assets = getFilteredHardwareAssets()) {
  const computerNames = new Set(assets.map((asset) => normalizeText(asset.computer_name)));
  const summary = assets.reduce((acc, asset) => {
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

  const online = hardwareLiveStatus.filter((live) => computerNames.has(normalizeText(live.computer_name)) && isMachineOnline(live));
  document.getElementById("hwOnline").innerText = online.length;
  const offEl = document.getElementById("hwOffline");
  if (offEl) offEl.innerText = Math.max(0, assets.length - online.length);
  document.getElementById("hwActiveAlerts").innerText = performanceAlerts.filter((alert) => computerNames.has(normalizeText(alert.computer_name)) && alert.status === "Ativo").length;
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
    svg.innerHTML = '<text x="250" y="66" text-anchor="middle">Aguardando histórico</text>';
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
    propertyItem("Identificacao", asset.display_name || asset.computer_name),
    propertyItem("Responsável atual", asset.responsible_name || "Sem responsável fixo"),
    propertyItem("Departamento", getAssetDepartment(asset)),
    propertyItem("Usuário do Windows", asset.user_name),
    propertyItem("Fabricante e modelo", `${asset.manufacturer || "-"} ${asset.model || ""}`.trim()),
    propertyItem("Processador", asset.cpu_name),
    propertyItem("Núcleos e threads", `${asset.cpu_cores || 0} nucleos / ${asset.cpu_logical_processors || 0} threads`),
    propertyItem("RAM instalada", `${asset.memory_total_gb || live?.memory_total_gb || "-"} GB`),
    propertyItem("Módulos de memória", describeMemoryModules(asset.memory_modules)),
    propertyItem("Placa de vídeo", describeGpu(asset.gpu)),
    propertyItem("Armazenamento", disks),
    propertyItem("Volumes", volumes),
    propertyItem("Windows", `${asset.os_caption || "-"} ${asset.os_version || ""}`.trim()),
    propertyItem("Tipo de sistema", asset.system_type || asset.os_architecture),
    propertyItem("Número de série", asset.serial_number),
    propertyItem("UUID do dispositivo", asset.device_uuid),
    propertyItem("ID do produto", asset.product_id),
    propertyItem("Tempo ligado", live ? formatUptime(live.uptime_seconds) : "-"),
    propertyItem("Última coleta de inventário", formatDateTime(asset.reported_at)),
    propertyItem("Última telemetria", live ? formatDateTime(live.last_seen) : "-"),
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
      <td>${escapeHtml(alert.cause_process || "Não identificado")}</td>
      <td>${escapeHtml(alert.activity_category || "-")}</td>
    </tr>
  `).join("");
}

function machineMatchesAsset(record, asset) {
  const an = normalizeText(asset.computer_name);
  const al = normalizeText(asset.display_name || asset.computer_name);
  const rn = normalizeText(record.computer_name);
  const rl = normalizeText(record.computer_label);
  return (rn && (rn === an || rn === al)) || (rl && (rl === al || rl === an));
}

function renderDeviceMaintenance(asset) {
  const body = document.getElementById("deviceMaintBody");
  if (!body) return;
  const rows = (typeof manutencoes !== "undefined" ? manutencoes : [])
    .filter((m) => machineMatchesAsset(m, asset))
    .sort((a, b) => new Date(b.data) - new Date(a.data));
  body.innerHTML = rows.length ? rows.map((m) => `
    <tr>
      <td>${escapeHtml(new Date(m.data).toLocaleDateString("pt-BR"))}</td>
      <td><span class="mov-badge entrada">${escapeHtml(m.tipo || "-")}</span></td>
      <td>${escapeHtml(m.descricao || "-")}</td>
      <td>${escapeHtml(m.responsavel || "-")}</td>
    </tr>`).join("") : '<tr><td colspan="4">Nenhuma manutenção registrada para esta máquina.</td></tr>';
}

function renderDeviceDeposit(asset) {
  const body = document.getElementById("deviceDepositBody");
  if (!body) return;
  const nameById = {};
  (typeof depositoItens !== "undefined" ? depositoItens : []).forEach((i) => { nameById[i.id] = i.nome; });
  const rows = (typeof depositoMovs !== "undefined" ? depositoMovs : [])
    .filter((mv) => machineMatchesAsset(mv, asset))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  body.innerHTML = rows.length ? rows.map((mv) => `
    <tr>
      <td>${escapeHtml(new Date(mv.created_at).toLocaleDateString("pt-BR"))}</td>
      <td>${escapeHtml(nameById[mv.item_id] || "-")}</td>
      <td><span class="mov-badge ${mv.tipo}">${mv.tipo === "entrada" ? "Entrada" : "Saída"}</span></td>
      <td>${Number(mv.quantidade)}</td>
      <td>${escapeHtml(mv.observacao || "-")}</td>
    </tr>`).join("") : '<tr><td colspan="5">Nenhuma peça do depósito registrada para esta máquina.</td></tr>';
}

function renderHardwareDetails() {
  const asset = hardwareAssets.find((item) => item.id === selectedHardwareId);
  if (!asset) return;
  const live = getLiveStatus(asset.computer_name);
  const online = isMachineOnline(live);
  const activeAlert = performanceAlerts.find((alert) => alert.computer_name === asset.computer_name && alert.status === "Ativo");

  document.getElementById("deviceDetailTitle").innerText = asset.display_name || asset.computer_name;
  document.getElementById("deviceDetailSubtitle").innerText = `${getAssetDepartment(asset)} | ${asset.manufacturer || ""} ${asset.model || ""}`;
  const liveBadge = document.getElementById("deviceLiveStatus");
  liveBadge.className = `device-live-status ${online ? "online" : "offline"}`;
  liveBadge.innerText = online ? "Online - atualização a cada 30 segundos" : "Offline ou sem agente ativo";

  const activity = live?.activity_category || "Atividade não identificada";
  setMetricDetail("Cpu", live?.cpu_percent, live?.top_cpu?.[0] ? `Maior consumo: ${live.top_cpu[0].name}` : "Sem processo dominante");
  setMetricDetail("Memory", live?.memory_percent, live?.top_memory?.[0] ? `Maior consumo: ${live.top_memory[0].name}` : "Sem processo dominante");
  setMetricDetail("Disk", live?.disk_percent, live?.top_io?.[0] ? `Maior E/S: ${live.top_io[0].name}` : "Sem processo dominante");
  document.getElementById("detailTopProcesses").innerHTML = `
    <h4>CPU</h4>${processList(live?.top_cpu, "cpu")}
    <h4>Memoria</h4>${processList(live?.top_memory, "memory")}
    <h4>Disco</h4>${processList(live?.top_io, "io")}
  `;
  document.getElementById("detailActivity").innerHTML = `
    <span>Aplicativo em primeiro plano</span><strong>${escapeHtml(live?.active_process || "Não identificado")}</strong>
    <span>Categoria observada</span><strong>${escapeHtml(activity)}</strong>
    ${activeAlert ? `<div class="active-cause"><b>Alerta ativo:</b> ${escapeHtml(activeAlert.message || activeAlert.metric)}</div>` : ""}
    <small>O sistema registra o aplicativo e a categoria, sem capturar URL, texto ou conteúdo do usuário.</small>
  `;
  renderSparkline("cpuHistoryChart", selectedHistory, "cpu_percent", "#38bdf8");
  renderSparkline("memoryHistoryChart", selectedHistory, "memory_percent", "#a78bfa");
  renderSparkline("diskHistoryChart", selectedHistory, "disk_percent", "#f59e0b");
  renderDeviceProperties(asset, live);
  renderPerformanceAlerts(asset.computer_name);
  renderDeviceMaintenance(asset);
  renderDeviceDeposit(asset);
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
    networkAlertsBody.innerHTML = '<tr><td colspan="6">Tabela network_alerts ainda não disponível. Rode o SQL supabase-network-alerts.sql no Supabase.</td></tr>';
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
    statusElement.innerText = critical ? "Oscilação" : "Atenção";
    banner.className = `network-health-banner ${critical ? "critical" : "warning"}`;
    banner.innerText = `${latest.title || "Problema de internet"}: ${latest.message || "Verifique o UniFi."}`;
  } else {
    statusElement.innerText = networkAlerts.length ? "Estável" : "Sem eventos";
    banner.className = "network-health-banner stable";
    banner.innerText = networkAlerts.length ? "Nenhuma oscilação ativa detectada nos últimos 30 minutos." : "Aguardando o primeiro evento do UniFi.";
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
        <td><span class="network-severity ${severityClass}">${escapeHtml(accentLabel(alert.severity || "Informacao"))}</span></td>
        <td><strong>${escapeHtml(alert.title || alert.event_type || "Evento UniFi")}</strong></td>
        <td>${escapeHtml(wan)}</td>
        <td>${escapeHtml(metrics)}</td>
        <td>${escapeHtml(alert.message || "-")}</td>
      </tr>
    `;
  }).join("");
}

// Botao "Avisar no WhatsApp" - so aparece nos chamados em que a pessoa OPTOU por receber avisos.
function waNotifyButton(ticket) {
  if (!ticket.avisar_whatsapp) return "";
  const digits = String(ticket.contato || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  const wa = digits.length <= 11 ? "55" + digits : digits;
  const proto = formatTicketNumber(ticket.id);
  const msgs = {
    "Aberto": `Ola! Seu chamado ${proto} no Grupo Azuos foi registrado. Guarde este numero para acompanhar.`,
    "Em atendimento": `Ola! Seu chamado ${proto} entrou em ATENDIMENTO. Ja estamos cuidando dele.`,
    "Resolvido": `Ola! Seu chamado ${proto} foi RESOLVIDO. Qualquer coisa, e so abrir um novo chamado.`,
  };
  const txt = encodeURIComponent(msgs[ticket.status] || msgs["Aberto"]);
  return `<a class="wa-notify" href="https://wa.me/${wa}?text=${txt}" target="_blank" rel="noopener" title="Avisar a pessoa no WhatsApp (${escapeHtml(ticket.status)})" onclick="event.stopPropagation()">📱 Avisar</a>`;
}

function renderTickets() {
  const text = filterText.value.trim().toLowerCase();
  const status = filterStatus.value;
  const filtered = allTickets.filter((ticket) =>
    (!text || (ticket._search || "").includes(text)) && (!status || ticket.status === status)
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / TICKETS_PER_PAGE));
  if (ticketsPage > totalPages) ticketsPage = totalPages;
  if (ticketsPage < 1) ticketsPage = 1;
  const startIndex = (ticketsPage - 1) * TICKETS_PER_PAGE;
  const pageItems = filtered.slice(startIndex, startIndex + TICKETS_PER_PAGE);

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="9">Nenhum chamado encontrado.</td></tr>';
    renderTicketMetrics();
    renderTicketsPager(0, 1);
    return;
  }

  body.innerHTML = pageItems.map((ticket) => `
    <tr class="ticket-row" onclick="openTicketDetails('${ticket.id}')" title="Clique para ver o chamado completo">
      <td><strong>${formatTicketNumber(ticket.id)}</strong><br><span class="prio-badge" data-prio="${priorityLabel(ticket.prioridade)}">${priorityLabel(ticket.prioridade)}</span></td>
      <td title="${escapeHtml(new Date(ticket.created_at).toLocaleString("pt-BR"))}">${escapeHtml(relativeTime(ticket.created_at))}</td>
      <td>${escapeHtml(ticket.nome)}</td>
      <td>${escapeHtml(ticket.departamento)}</td>
      <td>${escapeHtml(ticket.tipo)}</td>
      <td>${escapeHtml(ticket.anydesk || "-")}</td>
      <td onclick="event.stopPropagation()">
        ${ticket.status === "Resolvido"
          ? `<span class="status-locked" title="Chamado finalizado">✔ Resolvido</span>`
          : `<select class="status" data-status="${escapeHtml(ticket.status)}" onchange="changeStatus(${ticket.id}, this.value)">
          <option ${ticket.status === "Aberto" ? "selected" : ""}>Aberto</option>
          <option ${ticket.status === "Em atendimento" ? "selected" : ""}>Em atendimento</option>
          <option ${ticket.status === "Resolvido" ? "selected" : ""}>Resolvido</option>
        </select>`}
        ${waNotifyButton(ticket)}
      </td>
      <td class="desc-cell">${truncateText(ticket.descricao, 60)}</td>
      <td onclick="event.stopPropagation()" class="actions-cell">${ticket.print_url ? `<a href="${escapeHtml(ticket.print_url)}" target="_blank"><img class="print-img" src="${escapeHtml(ticket.print_url)}" alt="Print do chamado"></a>` : "-"}</td>
    </tr>
  `).join("");
  renderTicketMetrics();
  renderTicketsPager(filtered.length, totalPages);
}

function renderTicketMetrics() {
  const target = document.getElementById("ticketMetrics");
  if (!target) return;
  const open = allTickets.filter((t) => t.status === "Aberto").length;
  const inProgress = allTickets.filter((t) => t.status === "Em atendimento").length;
  const today = new Date().toDateString();
  const resolvedToday = allTickets.filter((t) => t.resolvido_em && new Date(t.resolvido_em).toDateString() === today).length;
  const durations = allTickets
    .filter((t) => t.resolvido_em && t.atendimento_em)
    .map((t) => new Date(t.resolvido_em).getTime() - new Date(t.atendimento_em).getTime())
    .filter((ms) => ms > 0);
  let avg = "-";
  if (durations.length) {
    const min = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60000);
    avg = min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
  }
  const cur = filterStatus.value;
  target.innerHTML = `
    <div class="ticket-metric m-open clickable ${cur === "Aberto" ? "active" : ""}" onclick="filtrarChamados('Aberto')" title="Clique para ver os chamados abertos"><span>Abertos</span><strong>${open}</strong></div>
    <div class="ticket-metric m-prog clickable ${cur === "Em atendimento" ? "active" : ""}" onclick="filtrarChamados('Em atendimento')" title="Clique para ver os que estão em atendimento"><span>Em atendimento</span><strong>${inProgress}</strong></div>
    <div class="ticket-metric m-done clickable ${cur === "Resolvido" ? "active" : ""}" onclick="filtrarChamados('Resolvido')" title="Clique para ver os resolvidos"><span>Resolvidos hoje</span><strong>${resolvedToday}</strong></div>
    <div class="ticket-metric" title="Média do tempo entre 'Em atendimento' e 'Resolvido'"><span>Tempo médio</span><strong>${avg}</strong></div>
  `;
}

window.filtrarChamados = function filtrarChamados(status) {
  filterStatus.value = filterStatus.value === status ? "" : status;
  ticketsPage = 1;
  renderTickets();
};

function renderTicketsPager(total, totalPages) {
  const pager = document.getElementById("ticketsPager");
  if (!pager) return;
  if (total <= TICKETS_PER_PAGE) {
    pager.innerHTML = total ? `<span class="pager-info">${total} chamado(s)</span>` : "";
    return;
  }
  pager.innerHTML = `
    <button class="secondary small" ${ticketsPage <= 1 ? "disabled" : ""} onclick="changeTicketsPage(-1)">Anterior</button>
    <span class="pager-info">Página ${ticketsPage} de ${totalPages} &middot; ${total} chamados</span>
    <button class="secondary small" ${ticketsPage >= totalPages ? "disabled" : ""} onclick="changeTicketsPage(1)">Próxima</button>
  `;
}

window.changeTicketsPage = function changeTicketsPage(delta) {
  ticketsPage += delta;
  renderTickets();
};

function truncateText(value, max = 60) {
  const text = String(value || "");
  if (text.length <= max) return escapeHtml(text);
  return escapeHtml(text.slice(0, max).trim()) + "…";
}

function ticketDetailRow(label, value) {
  return `<div class="ticket-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "-")}</strong></div>`;
}

const TICKET_TIPOS = ["Internet / Rede", "Computador lento", "Impressora", "E-mail", "Sistema interno", "Certificado digital", "Instalação de programa", "AnyDesk / Acesso remoto", "Outro"];

window.openTicketDetails = function openTicketDetails(id) {
  const ticket = allTickets.find((item) => String(item.id) === String(id));
  if (!ticket) return;
  document.getElementById("ticketDetailTitle").innerText = formatTicketNumber(ticket.id);
  const printBlock = ticket.print_url
    ? `<a href="${escapeHtml(ticket.print_url)}" target="_blank" rel="noopener"><img class="ticket-detail-print-img" src="${escapeHtml(ticket.print_url)}" alt="Print do chamado"></a>`
    : "Sem print anexado.";
  const resolvido = ticket.status === "Resolvido";
  const editSection = resolvido
    ? `<div class="ticket-detail-grid">
        ${ticketDetailRow("Prioridade", priorityLabel(ticket.prioridade))}
        ${ticketDetailRow("Responsável do TI", ticket.responsavel || "Não informado")}
      </div>
      <div class="ticket-detail-block">
        <span>Solução (o que o TI fez)</span>
        <p>${escapeHtml(ticket.solucao || "Não informado")}</p>
      </div>
      <div class="resolved-lock">🔒 Chamado finalizado (Resolvido). As informações não podem mais ser alteradas.</div>`
    : `<div class="ticket-detail-edit">
        <label>Tipo de problema
          <select id="ticketDetailTipo">
            ${(TICKET_TIPOS.includes(ticket.tipo) ? TICKET_TIPOS : [ticket.tipo, ...TICKET_TIPOS]).map((t) => `<option ${ticket.tipo === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
          </select>
        </label>
        <label>Prioridade
          <select id="ticketDetailPriority">
            <option ${priorityLabel(ticket.prioridade) === "Alta" ? "selected" : ""}>Alta</option>
            <option ${priorityLabel(ticket.prioridade) === "Média" ? "selected" : ""}>Média</option>
            <option ${priorityLabel(ticket.prioridade) === "Baixa" ? "selected" : ""}>Baixa</option>
          </select>
        </label>
        <label>Responsável do TI
          <input type="text" id="ticketDetailResponsible" value="${escapeHtml(ticket.responsavel || "")}" placeholder="Quem está cuidando">
        </label>
        <label style="grid-column:1/-1">O que o TI fez (solução)
          <textarea id="ticketDetailSolucao" placeholder="Descreva o que foi feito para resolver o problema...">${escapeHtml(ticket.solucao || "")}</textarea>
        </label>
      </div>`;
  const actionsSection = resolvido
    ? ``
    : `<button type="button" id="btnSaveTicketMeta" onclick="saveTicketMeta('${ticket.id}')">Salvar alterações</button>`;
  document.getElementById("ticketDetailBody").innerHTML = `
    <div class="ticket-detail-grid">
      ${ticketDetailRow("Status", ticket.status)}
      ${ticketDetailRow("Data", new Date(ticket.created_at).toLocaleString("pt-BR"))}
      ${ticketDetailRow("Nome", ticket.nome)}
      ${ticketDetailRow("Departamento", ticket.departamento)}
      ${ticketDetailRow("Tipo", ticket.tipo)}
      ${ticketDetailRow("AnyDesk", ticket.anydesk || "Não informado")}
      ${ticketDetailRow("Contato do solicitante", ticket.contato || "Não informado")}
      ${ticket.atendimento_em ? ticketDetailRow("Em atendimento desde", new Date(ticket.atendimento_em).toLocaleString("pt-BR")) : ""}
      ${ticket.resolvido_em ? ticketDetailRow("Resolvido em", new Date(ticket.resolvido_em).toLocaleString("pt-BR")) : ""}
    </div>
    <div class="ticket-detail-block">
      <span>Descrição</span>
      <p>${escapeHtml(ticket.descricao)}</p>
    </div>
    <div class="ticket-detail-block">
      <span>Print do erro</span>
      <div>${printBlock}</div>
    </div>
    ${editSection}
    <div class="ticket-detail-actions">
      ${actionsSection}
    </div>
  `;
  ticketDetailModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
};

function closeTicketDetails() {
  ticketDetailModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

document.getElementById("btnCloseTicketDetail").addEventListener("click", closeTicketDetails);
ticketDetailModal.addEventListener("click", (event) => {
  if (event.target === ticketDetailModal) closeTicketDetails();
});

window.changeStatus = async function changeStatus(id, status) {
  const ticket = allTickets.find((item) => String(item.id) === String(id));
  if (ticket && ticket.status === "Resolvido") {
    alert("Este chamado já foi finalizado (Resolvido) e não pode mais ser alterado.");
    await loadTickets();
    return;
  }
  if (status === "Resolvido" && !confirm("Marcar como RESOLVIDO finaliza o chamado — depois disso ele não poderá mais ser alterado. Confirmar?")) {
    await loadTickets();
    return;
  }
  const now = new Date().toISOString();
  const changes = { status };
  if (status === "Em atendimento" && ticket && !ticket.atendimento_em) changes.atendimento_em = now;
  changes.resolvido_em = status === "Resolvido" ? now : null;
  const { error } = await client.from("chamados").update(changes).eq("id", id);

  if (error) {
    alert("Erro ao alterar status: " + error.message);
    return;
  }

  await loadTickets();
};

window.deleteTicket = async function deleteTicket(id) {
  const ticket = allTickets.find((item) => String(item.id) === String(id));
  const label = ticket ? formatTicketNumber(ticket.id) : "este chamado";
  if (!confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`)) return;
  const { error } = await client.from("chamados").delete().eq("id", id);
  if (error) {
    alert("Erro ao excluir: " + error.message);
    return;
  }
  closeTicketDetails();
  await loadTickets();
};

window.saveTicketMeta = async function saveTicketMeta(id) {
  const prioridade = document.getElementById("ticketDetailPriority").value;
  const responsavel = document.getElementById("ticketDetailResponsible").value.trim() || null;
  const tipo = document.getElementById("ticketDetailTipo").value;
  const solucao = document.getElementById("ticketDetailSolucao").value.trim() || null;
  const { error } = await client.from("chamados").update({ prioridade, responsavel, tipo, solucao }).eq("id", id);
  if (error) {
    alert("Erro ao salvar: " + error.message);
    return;
  }
  closeTicketDetails();
  await loadTickets();
};

filterText.addEventListener("input", debounce(() => { ticketsPage = 1; renderTickets(); }, 250));
filterStatus.addEventListener("change", () => { ticketsPage = 1; renderTickets(); });

document.getElementById("btnExport").addEventListener("click", () => {
  const header = ["Chamado", "Data", "Nome", "Departamento", "Tipo", "AnyDesk", "Status", "Descrição", "Print"];
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

hardwareDepartmentFilter.addEventListener("change", renderAssets);
try { hardwareView = localStorage.getItem("hardwareView") || "cards"; } catch (e) {}
document.getElementById("hardwareSearch")?.addEventListener("input", debounce(renderAssets, 250));
document.getElementById("btnViewCards")?.addEventListener("click", () => { hardwareView = "cards"; try { localStorage.setItem("hardwareView", "cards"); } catch (e) {} applyHardwareView(); });
document.getElementById("btnViewTable")?.addEventListener("click", () => { hardwareView = "table"; try { localStorage.setItem("hardwareView", "table"); } catch (e) {} applyHardwareView(); });

function applyTypeFilterButtons() {
  document.getElementById("btnTypeAll")?.classList.toggle("active", hardwareTypeFilter === "");
  document.getElementById("btnTypeDesktop")?.classList.toggle("active", hardwareTypeFilter === "computador");
  document.getElementById("btnTypeNotebook")?.classList.toggle("active", hardwareTypeFilter === "notebook");
}
function setHardwareType(t) { hardwareTypeFilter = t; applyTypeFilterButtons(); renderAssets(); }
document.getElementById("btnTypeAll")?.addEventListener("click", () => setHardwareType(""));
document.getElementById("btnTypeDesktop")?.addEventListener("click", () => setHardwareType("computador"));
document.getElementById("btnTypeNotebook")?.addEventListener("click", () => setHardwareType("notebook"));
document.querySelectorAll(".assets-table th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (hardwareSort.key === key) hardwareSort.dir = hardwareSort.dir === "asc" ? "desc" : "asc";
    else { hardwareSort.key = key; hardwareSort.dir = "asc"; }
    renderAssets();
  });
});

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function plainDisks(disks) {
  if (!Array.isArray(disks) || !disks.length) return "-";
  return disks.map((disk) => `${disk.media_type || "Disco"} ${disk.size_gb || "-"} GB (${disk.health_status || disk.status || "-"})`).join(" | ");
}

function alertMetricCount(alerts, metric) {
  return alerts.filter((alert) => normalizeText(alert.metric) === normalizeText(metric)).length;
}

function alertMetricPeak(alerts, metric) {
  const values = alerts.filter((alert) => normalizeText(alert.metric) === normalizeText(metric)).map((alert) => Number(alert.peak_value || 0));
  return values.length ? `${Math.round(Math.max(...values))}%` : "-";
}

document.getElementById("btnExportHardwareReport").addEventListener("click", async () => {
  const button = document.getElementById("btnExportHardwareReport");
  const assets = getFilteredHardwareAssets();
  if (!assets.length) {
    alert("Nenhuma máquina encontrada para gerar o relatório.");
    return;
  }

  button.disabled = true;
  button.innerText = "Gerando relatório...";
  const computerNames = assets.map((asset) => asset.computer_name).filter(Boolean);
  const { data, error } = await client.from("hardware_performance_alerts")
    .select("*")
    .in("computer_name", computerNames)
    .order("started_at", { ascending: false });
  const reportAlerts = error ? performanceAlerts : (data || []);

  const rankedAssets = [...assets].sort((a, b) => {
    const aTickets = getAssetMonthTickets(a).length;
    const bTickets = getAssetMonthTickets(b).length;
    const aAlerts = reportAlerts.filter((alert) => normalizeText(alert.computer_name) === normalizeText(a.computer_name)).length;
    const bAlerts = reportAlerts.filter((alert) => normalizeText(alert.computer_name) === normalizeText(b.computer_name)).length;
    return (bTickets + bAlerts) - (aTickets + aAlerts);
  });

  const header = [
    "Departamento", "Computador", "Responsável atual", "Fabricante / modelo", "Integridade",
    "Chamados no mês", "Principais tipos de chamado", "CPU atual", "Memória atual", "Disco atual",
    "Alertas CPU", "Maior pico CPU", "Alertas memória", "Maior pico memória", "Alertas disco", "Maior pico disco",
    "Processos associados aos picos", "Atividades observadas", "Alertas ativos", "Discos instalados",
    "Última telemetria", "Última coleta de inventário",
  ];

  const rows = rankedAssets.map((asset) => {
    const tickets = getAssetMonthTickets(asset);
    const live = getLiveStatus(asset.computer_name);
    const alerts = reportAlerts.filter((alert) => normalizeText(alert.computer_name) === normalizeText(asset.computer_name));
    const ticketTypes = topEntries(groupCount(tickets, (ticket) => ticket.tipo), 5).map(([type, count]) => `${type} (${count})`).join(" | ") || "-";
    const causes = [...new Set(alerts.map((alert) => alert.cause_process).filter(Boolean))].join(" | ") || "-";
    const activities = [...new Set(alerts.map((alert) => alert.activity_category).filter(Boolean))].join(" | ") || "-";
    const health = suggestedHealth(asset, tickets.length);

    return [
      getAssetDepartment(asset), asset.display_name || asset.computer_name, asset.responsible_name || "Sem responsável fixo",
      `${asset.manufacturer || "-"} ${asset.model || ""}`.trim(), health, tickets.length, ticketTypes,
      live ? `${Math.round(Number(live.cpu_percent || 0))}%` : "Offline",
      live ? `${Math.round(Number(live.memory_percent || 0))}%` : "Offline",
      live ? `${Math.round(Number(live.disk_percent || 0))}%` : "Offline",
      alertMetricCount(alerts, "CPU"), alertMetricPeak(alerts, "CPU"),
      alertMetricCount(alerts, "Memoria"), alertMetricPeak(alerts, "Memoria"),
      alertMetricCount(alerts, "Disco"), alertMetricPeak(alerts, "Disco"),
      causes, activities, alerts.filter((alert) => alert.status === "Ativo").length, plainDisks(asset.disks),
      live ? formatDateTime(live.last_seen) : "-", formatDateTime(asset.reported_at),
    ];
  });

  const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const departmentName = hardwareDepartmentFilter.value || "todos-os-departamentos";
  const safeName = departmentName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  link.href = URL.createObjectURL(blob);
  link.download = `relatório-inventario-${safeName || "departamento"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  button.disabled = false;
  button.innerText = "Baixar relatório do departamento";
});

populateHardwareEditDepartment();

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
    scheduleRenderAssets();
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

// ===== Deposito de hardware (estoque: entrada e saida) =====
const DEPOSITO_CATEGORIAS = ["SSD", "Memória", "Monitor", "Teclado", "Mouse", "Fone de ouvido", "Adaptador DisplayPort → VGA", "Adaptador HDMI → VGA", "Máquina (CPU)", "Outro"];
let depositoStockFilter = ""; // "", "com" (com estoque), "zerados"
window.filtrarDepositoStock = function filtrarDepositoStock(f) {
  depositoStockFilter = depositoStockFilter === f ? "" : f;
  renderDeposito();
};
let depositoItens = [];
let depositoMovs = [];
let depositoLoadError = "";

function fillCategorySelect(el, includeAll) {
  if (!el) return;
  const current = el.value;
  el.innerHTML = (includeAll ? '<option value="">Todas as categorias</option>' : "") +
    DEPOSITO_CATEGORIAS.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
  if (current) el.value = current;
}

async function loadDeposito() {
  if (!document.getElementById("depositoBody")) return;
  const [itensRes, movsRes] = await Promise.all([
    client.from("deposito_itens").select("*").order("categoria", { ascending: true }).order("nome", { ascending: true }),
    client.from("deposito_movimentacoes").select("*").order("created_at", { ascending: false }).limit(50),
  ]);
  if (itensRes.error) { depositoLoadError = itensRes.error.message; depositoItens = []; }
  else { depositoLoadError = ""; depositoItens = itensRes.data || []; }
  depositoMovs = movsRes.error ? [] : (movsRes.data || []);
  renderDeposito();
}

function renderDeposito() {
  const listBody = document.getElementById("depositoBody");
  if (!listBody) return;
  fillCategorySelect(document.getElementById("depositoItemCategoria"), false);
  fillCategorySelect(document.getElementById("depositoCategoryFilter"), true);
  const metrics = document.getElementById("depositoMetrics");
  const movBody = document.getElementById("depositoMovBody");

  if (depositoLoadError) {
    listBody.innerHTML = '<tr><td colspan="5">Depósito ainda não disponível. Rode o SQL supabase-deposito.sql no Supabase.</td></tr>';
    if (metrics) metrics.innerHTML = "";
    if (movBody) movBody.innerHTML = "";
    return;
  }

  const filterCat = document.getElementById("depositoCategoryFilter").value;
  const condEl = document.getElementById("depositoCondFilter");
  const filterCond = condEl ? condEl.value : "";
  const condOf = (i) => ((i.condicao || "Novo") === "Usado" ? "Usado" : "Novo");
  const stockOk = (i) => depositoStockFilter === "" || (depositoStockFilter === "com" ? Number(i.quantidade || 0) > 0 : Number(i.quantidade || 0) <= 0);
  const items = depositoItens
    .filter((i) => (!filterCat || i.categoria === filterCat) && (!filterCond || condOf(i) === filterCond) && stockOk(i))
    .slice()
    .sort((a, b) =>
      String(a.categoria).localeCompare(String(b.categoria), "pt-BR", { numeric: true }) ||
      condOf(a).localeCompare(condOf(b)) ||
      String(a.nome).localeCompare(String(b.nome), "pt-BR", { numeric: true })
    );

  const totalUnidades = depositoItens.reduce((s, i) => s + Number(i.quantidade || 0), 0);
  const zerados = depositoItens.filter((i) => Number(i.quantidade || 0) <= 0).length;
  if (metrics) metrics.innerHTML = `
    <div class="ticket-metric clickable ${depositoStockFilter === "" ? "active" : ""}" onclick="filtrarDepositoStock('')" title="Ver todos os itens"><span>Tipos de item</span><strong>${depositoItens.length}</strong></div>
    <div class="ticket-metric clickable ${depositoStockFilter === "com" ? "active" : ""}" onclick="filtrarDepositoStock('com')" title="Ver só itens com estoque"><span>Unidades em estoque</span><strong>${totalUnidades}</strong></div>
    <div class="ticket-metric clickable ${depositoStockFilter === "zerados" ? "active" : ""}" onclick="filtrarDepositoStock('zerados')" title="Ver só itens zerados"><span>Itens zerados</span><strong>${zerados}</strong></div>
  `;

  listBody.innerHTML = items.length ? items.map((item) => `
    <tr>
      <td>${escapeHtml(item.categoria)}</td>
      <td><strong>${escapeHtml(item.nome)}</strong></td>
      <td><span class="cond-badge ${(item.condicao || "Novo") === "Usado" ? "usado" : "novo"}">${escapeHtml(item.condicao || "Novo")}</span></td>
      <td><span class="estoque-badge ${Number(item.quantidade) <= 0 ? "zero" : ""}">${Number(item.quantidade || 0)}</span></td>
      <td><div class="table-actions">
        <button class="secondary small" onclick="movimentarDeposito('${item.id}','entrada')">Entrada</button>
        <button class="secondary small" onclick="movimentarDeposito('${item.id}','saida')">Saída</button>
        <button class="secondary small" onclick="editarDepositoItem('${item.id}')">Editar</button>
        <button class="secondary small remove-hw" onclick="excluirDepositoItem('${item.id}')">Excluir</button>
      </div></td>
    </tr>
  `).join("") : '<tr><td colspan="5">Nenhum item cadastrado. Clique em "Adicionar item".</td></tr>';

  if (movBody) {
    const infoById = {};
    depositoItens.forEach((i) => { infoById[i.id] = { nome: i.nome, condicao: (i.condicao || "Novo") === "Usado" ? "Usado" : "Novo" }; });
    const movItemCell = (m) => {
      const info = infoById[m.item_id];
      const base = info ? `${escapeHtml(info.nome)} <span class="cond-badge ${info.condicao === "Usado" ? "usado" : "novo"}">${info.condicao}</span>` : escapeHtml(m.item_nome || "-");
      const maq = m.computer_label ? ` <span class="muted">→ ${escapeHtml(m.computer_label)}</span>` : "";
      return base + maq;
    };
    movBody.innerHTML = depositoMovs.length ? depositoMovs.map((m) => `
      <tr>
        <td>${escapeHtml(new Date(m.created_at).toLocaleString("pt-BR"))}</td>
        <td>${movItemCell(m)}</td>
        <td><span class="mov-badge ${m.tipo}">${m.tipo === "entrada" ? "Entrada" : "Saída"}</span></td>
        <td>${Number(m.quantidade)}</td>
        <td>${escapeHtml(m.responsavel || "-")}</td>
        <td>${escapeHtml(m.observacao || "-")}</td>
        <td><button class="secondary small" onclick="editarMovObs('${m.id}')">Editar</button></td>
      </tr>
    `).join("") : '<tr><td colspan="7">Nenhuma movimentação ainda.</td></tr>';
  }
}

function fillDepositoMovComputers(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const machines = [...hardwareAssets]
    .map((a) => ({ name: a.computer_name, label: a.display_name || a.computer_name, dept: getAssetDepartment(a) }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), "pt-BR", { numeric: true }));
  sel.innerHTML = '<option value="">— Nenhum / estoque geral —</option>'
    + machines.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.label)}${m.dept ? " — " + escapeHtml(m.dept) : ""} (${escapeHtml(m.name)})</option>`).join("");
}

window.movimentarDeposito = function movimentarDeposito(itemId, tipo) {
  const item = depositoItens.find((i) => i.id === itemId);
  if (!item) return;
  document.getElementById("depositoMovItemId").value = itemId;
  document.getElementById("depositoMovTipo").value = tipo;
  document.getElementById("depositoMovTitle").innerText = `${tipo === "entrada" ? "Entrada" : "Saída"} — ${item.nome}`;
  document.getElementById("depositoMovQtd").value = 1;
  document.getElementById("depositoMovResp").value = "";
  document.getElementById("depositoMovObs").value = "";
  fillDepositoMovComputers("depositoMovComputador");
  document.getElementById("depositoMovComputador").value = "";
  document.getElementById("depositoMovModal").classList.remove("hidden");
};

window.editarDepositoItem = function editarDepositoItem(id) {
  const item = depositoItens.find((i) => i.id === id);
  if (!item) return;
  document.getElementById("depositoEditId").value = item.id;
  document.getElementById("depositoEditNome").value = item.nome || "";
  fillCategorySelect(document.getElementById("depositoEditCategoria"), false);
  document.getElementById("depositoEditCategoria").value = item.categoria || "Outro";
  document.getElementById("depositoEditCondicao").value = (item.condicao || "Novo") === "Usado" ? "Usado" : "Novo";
  document.getElementById("depositoEditModal").classList.remove("hidden");
};

document.getElementById("btnCloseDepositoEdit")?.addEventListener("click", () => document.getElementById("depositoEditModal").classList.add("hidden"));

document.getElementById("depositoEditForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("depositoEditId").value;
  const nome = document.getElementById("depositoEditNome").value.trim();
  const categoria = document.getElementById("depositoEditCategoria").value;
  const condicao = document.getElementById("depositoEditCondicao").value || "Novo";
  if (!nome) return;
  const { error } = await client.from("deposito_itens").update({ nome, categoria, condicao }).eq("id", id);
  if (error) { alert("Erro ao salvar: " + error.message); return; }
  document.getElementById("depositoEditModal").classList.add("hidden");
  await loadDeposito();
});

window.excluirDepositoItem = async function excluirDepositoItem(id) {
  const item = depositoItens.find((i) => i.id === id);
  if (!confirm(`Excluir o item "${item ? item.nome : ""}" do depósito? Esta ação não pode ser desfeita.`)) return;
  const { error } = await client.from("deposito_itens").delete().eq("id", id);
  if (error) { alert("Erro ao excluir: " + error.message); return; }
  await loadDeposito();
};

document.getElementById("btnAddDepositoItem")?.addEventListener("click", () => {
  document.getElementById("depositoItemForm").reset();
  fillCategorySelect(document.getElementById("depositoItemCategoria"), false);
  document.getElementById("depositoItemModal").classList.remove("hidden");
});
document.getElementById("btnCloseDepositoItem")?.addEventListener("click", () => document.getElementById("depositoItemModal").classList.add("hidden"));
document.getElementById("btnCloseDepositoMov")?.addEventListener("click", () => document.getElementById("depositoMovModal").classList.add("hidden"));
document.getElementById("depositoCategoryFilter")?.addEventListener("change", renderDeposito);
document.getElementById("depositoCondFilter")?.addEventListener("change", renderDeposito);

document.getElementById("depositoItemForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nome = document.getElementById("depositoItemNome").value.trim();
  const categoria = document.getElementById("depositoItemCategoria").value;
  const quantidade = Math.max(0, parseInt(document.getElementById("depositoItemQtd").value, 10) || 0);
  const condicao = document.getElementById("depositoItemCondicao").value || "Novo";
  if (!nome) return;
  const { error } = await client.from("deposito_itens").insert({ nome, categoria, quantidade, condicao });
  if (error) { alert("Erro ao adicionar item: " + error.message); return; }
  document.getElementById("depositoItemModal").classList.add("hidden");
  await loadDeposito();
});

document.getElementById("depositoMovForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item_id = document.getElementById("depositoMovItemId").value;
  const tipo = document.getElementById("depositoMovTipo").value;
  const quantidade = Math.max(1, parseInt(document.getElementById("depositoMovQtd").value, 10) || 1);
  const responsavel = document.getElementById("depositoMovResp").value.trim() || null;
  const observacao = document.getElementById("depositoMovObs").value.trim() || null;
  const compSel = document.getElementById("depositoMovComputador");
  const computer_name = compSel && compSel.value ? compSel.value : null;
  let computer_label = null;
  if (computer_name) {
    const asset = hardwareAssets.find((a) => a.computer_name === computer_name);
    computer_label = asset ? (asset.display_name || asset.computer_name) : computer_name;
  }
  const { error } = await client.from("deposito_movimentacoes").insert({ item_id, tipo, quantidade, responsavel, observacao, computer_name, computer_label });
  if (error) { alert("Erro ao registrar movimentação: " + error.message); return; }
  document.getElementById("depositoMovModal").classList.add("hidden");
  await loadDeposito();
});

// Editar apenas a observacao/responsavel de uma movimentacao (nao mexe no estoque).
window.editarMovObs = function editarMovObs(id) {
  const mov = depositoMovs.find((m) => String(m.id) === String(id));
  if (!mov) return;
  document.getElementById("depositoMovEditId").value = mov.id;
  document.getElementById("depositoMovEditResp").value = mov.responsavel || "";
  document.getElementById("depositoMovEditObs").value = mov.observacao || "";
  fillDepositoMovComputers("depositoMovEditComputador");
  document.getElementById("depositoMovEditComputador").value = mov.computer_name || "";
  document.getElementById("depositoMovEditModal").classList.remove("hidden");
};
document.getElementById("btnCloseDepositoMovEdit")?.addEventListener("click", () => document.getElementById("depositoMovEditModal").classList.add("hidden"));
document.getElementById("depositoMovEditForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("depositoMovEditId").value;
  const responsavel = document.getElementById("depositoMovEditResp").value.trim() || null;
  const observacao = document.getElementById("depositoMovEditObs").value.trim() || null;
  const compSel = document.getElementById("depositoMovEditComputador");
  const computer_name = compSel && compSel.value ? compSel.value : null;
  let computer_label = null;
  if (computer_name) {
    const asset = hardwareAssets.find((a) => a.computer_name === computer_name);
    computer_label = asset ? (asset.display_name || asset.computer_name) : computer_name;
  }
  const { error } = await client.from("deposito_movimentacoes").update({ responsavel, observacao, computer_name, computer_label }).eq("id", id);
  if (error) { alert("Erro ao salvar: " + error.message); return; }
  document.getElementById("depositoMovEditModal").classList.add("hidden");
  await loadDeposito();
});

// ===== Manutencao dos computadores =====
const MANUTENCAO_TIPOS = ["Preventiva", "Corretiva", "Troca de peça", "Formatação/Reinstalação", "Limpeza", "Outro"];
let manutencoes = [];
let manutencoesLoadError = "";

async function loadManutencoes() {
  if (!document.getElementById("manutencaoBody")) return;
  const { data, error } = await client.from("manutencoes").select("*").order("data", { ascending: false }).limit(300);
  if (error) { manutencoesLoadError = error.message; manutencoes = []; }
  else { manutencoesLoadError = ""; manutencoes = data || []; }
  renderManutencoes();
  // Atualiza o dashboard para refletir os alertas de maquinas.
  if (document.getElementById("statAlerts")) renderDashboard();
}

function fillManutencaoComputers() {
  const modalSel = document.getElementById("manutencaoComputador");
  if (modalSel) {
    const machines = [...hardwareAssets]
      .map((a) => ({ name: a.computer_name, label: a.display_name || a.computer_name, dept: getAssetDepartment(a) }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label), "pt-BR", { numeric: true }));
    const opts = machines
      .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.label)}${m.dept ? " — " + escapeHtml(m.dept) : ""} (${escapeHtml(m.name)})</option>`)
      .join("");
    modalSel.innerHTML = opts + '<option value="__outro__">— Outro / máquina fora da operação —</option>';
  }
  const filterSel = document.getElementById("manutencaoFilter");
  if (filterSel) {
    const current = filterSel.value;
    const uniq = {};
    manutencoes.forEach((m) => {
      const key = m.computer_name || m.computer_label;
      if (key && !uniq[key]) uniq[key] = `${m.computer_label || key}${m.computer_department ? " — " + m.computer_department : ""}`;
    });
    const entries = Object.entries(uniq).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR", { numeric: true }));
    filterSel.innerHTML = '<option value="">Todos os computadores</option>' + entries.map(([k, label]) => `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`).join("");
    if (uniq[current]) filterSel.value = current;
  }
}

function renderManutencoes() {
  const body = document.getElementById("manutencaoBody");
  if (!body) return;
  fillManutencaoComputers();
  const rankBody = document.getElementById("manutencaoRankBody");
  const metrics = document.getElementById("manutencaoMetrics");

  if (manutencoesLoadError) {
    body.innerHTML = '<tr><td colspan="6">Manutenção ainda não disponível. Rode o SQL supabase-manutencao.sql no Supabase.</td></tr>';
    if (rankBody) rankBody.innerHTML = "";
    if (metrics) metrics.innerHTML = "";
    return;
  }

  const now = new Date();
  const isMonth = (d) => { const x = new Date(d); return x.getMonth() === now.getMonth() && x.getFullYear() === now.getFullYear(); };

  const machineLabel = (m) => `${m.computer_label || m.computer_name || "Sem identificação"}${m.computer_department ? " — " + m.computer_department : ""}`;
  const ALERTA_MIN = 3;
  const byMachine = {};
  manutencoes.forEach((m) => {
    const key = m.computer_name || m.computer_label || "Sem identificação";
    if (!byMachine[key]) byMachine[key] = { total: 0, mes: 0, label: machineLabel(m), key };
    byMachine[key].total += 1;
    if (isMonth(m.data)) byMachine[key].mes += 1;
  });
  const ranking = Object.values(byMachine).sort((a, b) => b.total - a.total);

  if (metrics) {
    const totalMes = manutencoes.filter((m) => isMonth(m.data)).length;
    const top = ranking[0];
    const topLabel = top ? top.label : "-";
    metrics.innerHTML = `
      <div class="ticket-metric"><span>Manutenções no mês</span><strong>${totalMes}</strong></div>
      <div class="ticket-metric"><span>Total de registros</span><strong>${manutencoes.length}</strong></div>
      <div class="ticket-metric metric-attention ${top ? "clickable" : ""}" ${top ? `id="metricTopMachine" data-key="${escapeHtml(top.key)}" title="Clique para ver o histórico dela"` : ""}><span>Máquina mais mexida</span><strong style="font-size:15px">${escapeHtml(topLabel)}</strong></div>
    `;
    const topBox = document.getElementById("metricTopMachine");
    if (topBox) topBox.addEventListener("click", () => filtrarManutencao(topBox.dataset.key));
  }

  const alertBox = document.getElementById("manutencaoAlertas");
  if (alertBox) {
    const criticas = getManutencaoAlertas(ALERTA_MIN);
    alertBox.innerHTML = criticas.map((c) => `
      <div class="manut-alert clickable" data-key="${escapeHtml(c.key)}" title="Clique para ver o histórico dela">
        <span>⚠️ <strong>${escapeHtml(c.label)}</strong> já tem <strong>${c.total}</strong> manutenções registradas. Avalie se ainda compensa mantê-la na operação.</span>
        <span class="manut-alert-link">Ver histórico →</span>
      </div>
    `).join("");
    alertBox.querySelectorAll(".manut-alert.clickable").forEach((el) => el.addEventListener("click", () => filtrarManutencao(el.dataset.key)));
  }

  if (rankBody) {
    rankBody.innerHTML = ranking.length ? ranking.map((c) => `
      <tr class="rank-row clickable" data-key="${escapeHtml(c.key)}" title="Clique para ver o histórico dela">
        <td><strong>${escapeHtml(c.label)}</strong></td>
        <td>${c.mes}</td>
        <td><span class="estoque-badge ${c.total >= ALERTA_MIN ? "zero" : ""}">${c.total}</span></td>
      </tr>
    `).join("") : '<tr><td colspan="3">Nenhuma manutenção registrada.</td></tr>';
    rankBody.querySelectorAll(".rank-row.clickable").forEach((el) => el.addEventListener("click", () => filtrarManutencao(el.dataset.key)));
  }

  const filter = document.getElementById("manutencaoFilter").value;
  const rows = filter ? manutencoes.filter((m) => (m.computer_name || m.computer_label) === filter) : manutencoes;
  body.innerHTML = rows.length ? rows.map((m) => `
    <tr>
      <td>${escapeHtml(new Date(m.data).toLocaleDateString("pt-BR"))}</td>
      <td><strong>${escapeHtml(machineLabel(m))}</strong></td>
      <td><span class="mov-badge entrada">${escapeHtml(m.tipo || "-")}</span></td>
      <td>${escapeHtml(m.descricao || "-")}</td>
      <td>${escapeHtml(m.responsavel || "-")}</td>
      <td><button type="button" class="ticket-delete" onclick="excluirManutencao('${m.id}')">Excluir</button></td>
    </tr>
  `).join("") : '<tr><td colspan="6">Nenhuma manutenção para este filtro.</td></tr>';
}

window.filtrarManutencao = function filtrarManutencao(key) {
  const sel = document.getElementById("manutencaoFilter");
  if (!sel || !key) return;
  sel.value = sel.value === key ? "" : key;
  renderManutencoes();
  document.getElementById("manutencaoBody")?.closest(".table-wrap")?.scrollIntoView({ behavior: "smooth", block: "center" });
};

window.excluirManutencao = async function excluirManutencao(id) {
  if (!confirm("Excluir este registro de manutenção?")) return;
  const { error } = await client.from("manutencoes").delete().eq("id", id);
  if (error) { alert("Erro ao excluir: " + error.message); return; }
  await loadManutencoes();
};

function toggleManutencaoOutro() {
  const sel = document.getElementById("manutencaoComputador");
  const wrap = document.getElementById("manutencaoOutroWrap");
  if (!sel || !wrap) return;
  wrap.classList.toggle("hidden", sel.value !== "__outro__");
}

document.getElementById("btnAddManutencao")?.addEventListener("click", () => {
  document.getElementById("manutencaoForm").reset();
  document.getElementById("manutencaoTipo").innerHTML = MANUTENCAO_TIPOS.map((t) => `<option>${escapeHtml(t)}</option>`).join("");
  fillManutencaoComputers();
  toggleManutencaoOutro();
  document.getElementById("manutencaoData").value = new Date().toISOString().slice(0, 10);
  document.getElementById("manutencaoModal").classList.remove("hidden");
});
document.getElementById("manutencaoComputador")?.addEventListener("change", toggleManutencaoOutro);
document.getElementById("btnCloseManutencao")?.addEventListener("click", () => document.getElementById("manutencaoModal").classList.add("hidden"));
document.getElementById("manutencaoFilter")?.addEventListener("change", renderManutencoes);

document.getElementById("manutencaoForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sel = document.getElementById("manutencaoComputador");
  let computer_name, computer_label, computer_department = null;
  if (sel.value === "__outro__") {
    const outro = document.getElementById("manutencaoComputadorOutro").value.trim();
    if (!outro) { alert("Digite o nome/identificação da máquina."); return; }
    computer_name = outro;
    computer_label = outro;
    computer_department = "Fora da operação";
  } else {
    computer_name = sel.value || null;
    const asset = hardwareAssets.find((a) => a.computer_name === computer_name);
    computer_label = asset ? (asset.display_name || asset.computer_name) : computer_name;
    computer_department = asset ? getAssetDepartment(asset) : null;
  }
  const tipo = document.getElementById("manutencaoTipo").value;
  const descricao = document.getElementById("manutencaoDescricao").value.trim() || null;
  const responsavel = document.getElementById("manutencaoResp").value.trim() || null;
  const dataStr = document.getElementById("manutencaoData").value;
  const data = dataStr ? new Date(dataStr + "T12:00:00").toISOString() : new Date().toISOString();
  const { error } = await client.from("manutencoes").insert({ computer_name, computer_label, computer_department, tipo, descricao, responsavel, data });
  if (error) { alert("Erro ao salvar: " + error.message); return; }
  document.getElementById("manutencaoModal").classList.add("hidden");
  await loadManutencoes();
});

// Guard de sessao: so libera o painel com login valido no Supabase Auth.
async function initAdmin() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    window.location.replace("login.html");
    return;
  }
  document.body.style.visibility = "visible";
  loadTickets();
  loadDeposito();
  loadManutencoes();
}

client.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") window.location.replace("login.html");
});

initAdmin();

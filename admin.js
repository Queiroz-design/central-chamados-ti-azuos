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
const chartColors = ["#0057d8", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777"];
const companyDepartments = [
  "ANALYZE", "CERTIFICADO", "COMERCIAL", "CONT\u00c1BIL", "CS", "FINANCEIRO",
  "FISCAL", "INTEGRA\u00c7\u00c3O", "PARALEGAL", "PESSOAL", "RECEP\u00c7\u00c3O", "RH",
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

// Filtro por saude: clicar nas caixas abre as maquinas daquele estado.
document.querySelectorAll(".health-filter").forEach((box) => {
  box.addEventListener("click", () => {
    const h = box.dataset.health;
    hardwareHealthFilter = (h === "all" || hardwareHealthFilter === h) ? "" : h;
    document.querySelectorAll(".health-filter").forEach((b) => b.classList.toggle("active", b.dataset.health === hardwareHealthFilter && hardwareHealthFilter !== ""));
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
    alertsList.innerHTML = '<div class="empty-state">Nenhuma recorrência crítica neste mês.</div>';
    return;
  }

  alertsList.innerHTML = alerts.map((alert) => `
    <article class="alert-item">
      <strong>${escapeHtml(alert.nome)} abriu ${alert.count} chamados de ${escapeHtml(alert.tipo)}</strong>
      <span>${escapeHtml(alert.departamento || "Departamento não informado")} precisa de verificação preventiva.</span>
    </article>
  `).join("");
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

function getFilteredHardwareAssets() {
  const department = normalizeText(hardwareDepartmentFilter.value);
  const searchInput = document.getElementById("hardwareSearch");
  const search = normalizeText(searchInput ? searchInput.value : "");
  let list = department
    ? hardwareAssets.filter((asset) => normalizeText(getAssetDepartment(asset)) === department)
    : hardwareAssets.slice();
  if (search) {
    list = list.filter((asset) =>
      `${asset.display_name || ""} ${asset.computer_name || ""} ${getAssetDepartment(asset)} ${asset.model || ""} ${asset.cpu_name || ""} ${asset.manufacturer || ""}`
        .toLowerCase().includes(search)
    );
  }
  const dir = hardwareSort.dir === "desc" ? -1 : 1;
  list.sort((a, b) => {
    const va = assetSortValue(a, hardwareSort.key);
    const vb = assetSortValue(b, hardwareSort.key);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * dir;
  });
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

  const displayAssets = hardwareHealthFilter
    ? filteredAssets.filter((asset) => suggestedHealth(asset, getAssetSignals(asset).monthCount) === hardwareHealthFilter)
    : filteredAssets;

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
            <span>${escapeHtml(getAssetDepartment(asset))} - ${escapeHtml(asset.model || "-")}</span>
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
        <td><div class="table-actions"><button class="secondary small" onclick="openHardwareDetails('${asset.id}')">Detalhes</button><button class="secondary small" onclick="event.stopPropagation();editHardware('${asset.id}')">Editar</button><button class="secondary small remove-hw" onclick="event.stopPropagation();archiveHardware('${asset.id}')">Remover</button></div></td>
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
        <select class="status" data-status="${escapeHtml(ticket.status)}" onchange="changeStatus(${ticket.id}, this.value)">
          <option ${ticket.status === "Aberto" ? "selected" : ""}>Aberto</option>
          <option ${ticket.status === "Em atendimento" ? "selected" : ""}>Em atendimento</option>
          <option ${ticket.status === "Resolvido" ? "selected" : ""}>Resolvido</option>
        </select>
      </td>
      <td class="desc-cell">${truncateText(ticket.descricao, 60)}</td>
      <td onclick="event.stopPropagation()" class="actions-cell">${ticket.print_url ? `<a href="${escapeHtml(ticket.print_url)}" target="_blank"><img class="print-img" src="${escapeHtml(ticket.print_url)}" alt="Print do chamado"></a>` : ""}<button type="button" class="ticket-delete" title="Excluir chamado" onclick="deleteTicket('${ticket.id}')">Excluir</button></td>
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
  target.innerHTML = `
    <div class="ticket-metric"><span>Abertos</span><strong>${open}</strong></div>
    <div class="ticket-metric"><span>Em atendimento</span><strong>${inProgress}</strong></div>
    <div class="ticket-metric"><span>Resolvidos hoje</span><strong>${resolvedToday}</strong></div>
    <div class="ticket-metric" title="Média do tempo entre 'Em atendimento' e 'Resolvido'"><span>Tempo médio</span><strong>${avg}</strong></div>
  `;
}

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

window.openTicketDetails = function openTicketDetails(id) {
  const ticket = allTickets.find((item) => String(item.id) === String(id));
  if (!ticket) return;
  document.getElementById("ticketDetailTitle").innerText = formatTicketNumber(ticket.id);
  const printBlock = ticket.print_url
    ? `<a href="${escapeHtml(ticket.print_url)}" target="_blank" rel="noopener"><img class="ticket-detail-print-img" src="${escapeHtml(ticket.print_url)}" alt="Print do chamado"></a>`
    : "Sem print anexado.";
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
    <div class="ticket-detail-edit">
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
    </div>
    <div class="ticket-detail-actions">
      <button type="button" id="btnSaveTicketMeta" onclick="saveTicketMeta('${ticket.id}')">Salvar prioridade e responsável</button>
      <button type="button" class="danger" onclick="deleteTicket('${ticket.id}')">Excluir chamado</button>
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
  const { error } = await client.from("chamados").update({ prioridade, responsavel }).eq("id", id);
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
const DEPOSITO_CATEGORIAS = ["SSD", "Memória", "Monitor", "Teclado", "Mouse", "Adaptador DisplayPort → VGA", "Adaptador HDMI → VGA", "Máquina (CPU)", "Outro"];
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
    listBody.innerHTML = '<tr><td colspan="4">Depósito ainda não disponível. Rode o SQL supabase-deposito.sql no Supabase.</td></tr>';
    if (metrics) metrics.innerHTML = "";
    if (movBody) movBody.innerHTML = "";
    return;
  }

  const filterCat = document.getElementById("depositoCategoryFilter").value;
  const items = filterCat ? depositoItens.filter((i) => i.categoria === filterCat) : depositoItens;

  const totalUnidades = depositoItens.reduce((s, i) => s + Number(i.quantidade || 0), 0);
  const zerados = depositoItens.filter((i) => Number(i.quantidade || 0) <= 0).length;
  if (metrics) metrics.innerHTML = `
    <div class="ticket-metric"><span>Tipos de item</span><strong>${depositoItens.length}</strong></div>
    <div class="ticket-metric"><span>Unidades em estoque</span><strong>${totalUnidades}</strong></div>
    <div class="ticket-metric"><span>Itens zerados</span><strong>${zerados}</strong></div>
  `;

  listBody.innerHTML = items.length ? items.map((item) => `
    <tr>
      <td>${escapeHtml(item.categoria)}</td>
      <td><strong>${escapeHtml(item.nome)}</strong></td>
      <td><span class="estoque-badge ${Number(item.quantidade) <= 0 ? "zero" : ""}">${Number(item.quantidade || 0)}</span></td>
      <td><div class="table-actions">
        <button class="secondary small" onclick="movimentarDeposito('${item.id}','entrada')">Entrada</button>
        <button class="secondary small" onclick="movimentarDeposito('${item.id}','saida')">Saída</button>
        <button class="secondary small remove-hw" onclick="excluirDepositoItem('${item.id}')">Excluir</button>
      </div></td>
    </tr>
  `).join("") : '<tr><td colspan="4">Nenhum item cadastrado. Clique em "Adicionar item".</td></tr>';

  if (movBody) {
    const nameById = {};
    depositoItens.forEach((i) => { nameById[i.id] = i.nome; });
    movBody.innerHTML = depositoMovs.length ? depositoMovs.map((m) => `
      <tr>
        <td>${escapeHtml(new Date(m.created_at).toLocaleString("pt-BR"))}</td>
        <td>${escapeHtml(nameById[m.item_id] || "-")}</td>
        <td><span class="mov-badge ${m.tipo}">${m.tipo === "entrada" ? "Entrada" : "Saída"}</span></td>
        <td>${Number(m.quantidade)}</td>
        <td>${escapeHtml(m.responsavel || "-")}</td>
        <td>${escapeHtml(m.observacao || "-")}</td>
      </tr>
    `).join("") : '<tr><td colspan="6">Nenhuma movimentação ainda.</td></tr>';
  }
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
  document.getElementById("depositoMovModal").classList.remove("hidden");
};

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

document.getElementById("depositoItemForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nome = document.getElementById("depositoItemNome").value.trim();
  const categoria = document.getElementById("depositoItemCategoria").value;
  const quantidade = Math.max(0, parseInt(document.getElementById("depositoItemQtd").value, 10) || 0);
  if (!nome) return;
  const { error } = await client.from("deposito_itens").insert({ nome, categoria, quantidade });
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
  const { error } = await client.from("deposito_movimentacoes").insert({ item_id, tipo, quantidade, responsavel, observacao });
  if (error) { alert("Erro ao registrar movimentação: " + error.message); return; }
  document.getElementById("depositoMovModal").classList.add("hidden");
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
}

function fillManutencaoComputers() {
  const modalSel = document.getElementById("manutencaoComputador");
  if (modalSel) {
    const machines = [...hardwareAssets]
      .map((a) => ({ name: a.computer_name, label: a.display_name || a.computer_name }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label), "pt-BR", { numeric: true }));
    modalSel.innerHTML = machines.length
      ? machines.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.label)}</option>`).join("")
      : '<option value="">Nenhuma máquina no inventário</option>';
  }
  const filterSel = document.getElementById("manutencaoFilter");
  if (filterSel) {
    const current = filterSel.value;
    const labels = [...new Set(manutencoes.map((m) => m.computer_label || m.computer_name).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
    filterSel.innerHTML = '<option value="">Todos os computadores</option>' + labels.map((l) => `<option>${escapeHtml(l)}</option>`).join("");
    if (labels.includes(current)) filterSel.value = current;
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

  const byMachine = {};
  manutencoes.forEach((m) => {
    const key = m.computer_label || m.computer_name || "Sem identificação";
    if (!byMachine[key]) byMachine[key] = { total: 0, mes: 0 };
    byMachine[key].total += 1;
    if (isMonth(m.data)) byMachine[key].mes += 1;
  });
  const ranking = Object.entries(byMachine).sort((a, b) => b[1].total - a[1].total);

  if (metrics) {
    const totalMes = manutencoes.filter((m) => isMonth(m.data)).length;
    const topLabel = ranking.length ? ranking[0][0] : "-";
    metrics.innerHTML = `
      <div class="ticket-metric"><span>Manutenções no mês</span><strong>${totalMes}</strong></div>
      <div class="ticket-metric"><span>Total de registros</span><strong>${manutencoes.length}</strong></div>
      <div class="ticket-metric"><span>Máquina mais mexida</span><strong style="font-size:16px">${escapeHtml(topLabel)}</strong></div>
    `;
  }

  if (rankBody) {
    rankBody.innerHTML = ranking.length ? ranking.map(([label, c]) => `
      <tr>
        <td><strong>${escapeHtml(label)}</strong></td>
        <td>${c.mes}</td>
        <td><span class="estoque-badge ${c.total >= 4 ? "zero" : ""}">${c.total}</span></td>
      </tr>
    `).join("") : '<tr><td colspan="3">Nenhuma manutenção registrada.</td></tr>';
  }

  const filter = document.getElementById("manutencaoFilter").value;
  const rows = filter ? manutencoes.filter((m) => (m.computer_label || m.computer_name) === filter) : manutencoes;
  body.innerHTML = rows.length ? rows.map((m) => `
    <tr>
      <td>${escapeHtml(new Date(m.data).toLocaleDateString("pt-BR"))}</td>
      <td><strong>${escapeHtml(m.computer_label || m.computer_name || "-")}</strong></td>
      <td><span class="mov-badge entrada">${escapeHtml(m.tipo || "-")}</span></td>
      <td>${escapeHtml(m.descricao || "-")}</td>
      <td>${escapeHtml(m.responsavel || "-")}</td>
      <td><button type="button" class="ticket-delete" onclick="excluirManutencao('${m.id}')">Excluir</button></td>
    </tr>
  `).join("") : '<tr><td colspan="6">Nenhuma manutenção para este filtro.</td></tr>';
}

window.excluirManutencao = async function excluirManutencao(id) {
  if (!confirm("Excluir este registro de manutenção?")) return;
  const { error } = await client.from("manutencoes").delete().eq("id", id);
  if (error) { alert("Erro ao excluir: " + error.message); return; }
  await loadManutencoes();
};

document.getElementById("btnAddManutencao")?.addEventListener("click", () => {
  document.getElementById("manutencaoForm").reset();
  document.getElementById("manutencaoTipo").innerHTML = MANUTENCAO_TIPOS.map((t) => `<option>${escapeHtml(t)}</option>`).join("");
  fillManutencaoComputers();
  document.getElementById("manutencaoData").value = new Date().toISOString().slice(0, 10);
  document.getElementById("manutencaoModal").classList.remove("hidden");
});
document.getElementById("btnCloseManutencao")?.addEventListener("click", () => document.getElementById("manutencaoModal").classList.add("hidden"));
document.getElementById("manutencaoFilter")?.addEventListener("change", renderManutencoes);

document.getElementById("manutencaoForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sel = document.getElementById("manutencaoComputador");
  const computer_name = sel.value || null;
  const computer_label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : computer_name;
  const tipo = document.getElementById("manutencaoTipo").value;
  const descricao = document.getElementById("manutencaoDescricao").value.trim() || null;
  const responsavel = document.getElementById("manutencaoResp").value.trim() || null;
  const dataStr = document.getElementById("manutencaoData").value;
  const data = dataStr ? new Date(dataStr + "T12:00:00").toISOString() : new Date().toISOString();
  const { error } = await client.from("manutencoes").insert({ computer_name, computer_label, tipo, descricao, responsavel, data });
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

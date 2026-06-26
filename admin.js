const body = document.getElementById("ticketsBody");
const filterText = document.getElementById("filterText");
const filterStatus = document.getElementById("filterStatus");
const assetsBody = document.getElementById("assetsBody");
const hardwareCards = document.getElementById("hardwareCards");
const chartColors = ["#0057d8", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777"];

let allTickets = [];
let hardwareAssets = [];
let hardwareLoadError = "";

document.getElementById("btnLogout").addEventListener("click", () => {
  sessionStorage.removeItem("ti_logado");
  window.location.href = "login.html";
});

document.getElementById("btnRefresh").addEventListener("click", loadTickets);

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
  const [{ data, error }, hardwareResult] = await Promise.all([ticketsRequest, hardwareRequest]);

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

  allTickets = data || [];
  renderDashboard();
  renderAssets();
  renderTickets();
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

function renderAssets() {
  if (hardwareLoadError) {
    const message = "Tabela hardware_inventory ainda nao disponivel. Rode o SQL supabase-hardware-inventory.sql no Supabase.";
    assetsBody.innerHTML = `<tr><td colspan="8">${escapeHtml(message)}</td></tr>`;
    hardwareCards.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    updateHardwareSummary();
    renderDashboard();
    return;
  }

  updateHardwareSummary();

  if (!hardwareAssets.length) {
    assetsBody.innerHTML = '<tr><td colspan="8">Nenhuma maquina enviou inventario ainda. Baixe o coletor e execute nos computadores.</td></tr>';
    hardwareCards.innerHTML = '<div class="empty-state">Aguardando primeira coleta de hardware.</div>';
    renderDashboard();
    return;
  }

  hardwareCards.innerHTML = hardwareAssets.slice(0, 6).map((asset) => {
    const signals = getAssetSignals(asset);
    const health = suggestedHealth(asset, signals.monthCount);
    const score = Number(asset.health_score || 0);

    return `
      <article class="hardware-card ${health.toLowerCase()}">
        <div class="hardware-card-top">
          <div>
            <strong>${escapeHtml(asset.computer_name)}</strong>
            <span>${escapeHtml(asset.user_name || "-")} - ${escapeHtml(asset.model || "-")}</span>
          </div>
          <span class="health-badge ${health.toLowerCase()}">${health}</span>
        </div>
        <div class="health-meter"><span style="width:${Math.max(score, 4)}%"></span></div>
        <div class="hardware-score">${score}/100</div>
        <p>${formatWarnings(asset.warnings)}</p>
      </article>
    `;
  }).join("");

  assetsBody.innerHTML = hardwareAssets.map((asset) => {
    const signals = getAssetSignals(asset);
    const health = suggestedHealth(asset, signals.monthCount);

    return `
      <tr>
        <td><strong>${escapeHtml(asset.computer_name)}</strong><br><span class="muted">${escapeHtml(asset.serial_number || "-")}</span></td>
        <td>${escapeHtml(asset.user_name || "-")}<br><span class="muted">${escapeHtml(asset.domain_name || "-")}</span></td>
        <td>${escapeHtml(asset.manufacturer || "-")}<br><span class="muted">${escapeHtml(asset.model || "-")}</span></td>
        <td>${escapeHtml(asset.memory_total_gb || "-")} GB<br><span class="muted">${escapeHtml(asset.memory_slots || 0)} pente(s)</span></td>
        <td>${formatDisks(asset.disks)}</td>
        <td>${signals.monthCount}</td>
        <td><span class="health-badge ${health.toLowerCase()}">${health}</span><br><span class="muted">${escapeHtml(asset.health_score || 0)}/100</span></td>
        <td>${formatDateTime(asset.reported_at)}</td>
      </tr>
    `;
  }).join("");

  renderDashboard();
}

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

loadTickets();

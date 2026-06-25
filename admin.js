const body = document.getElementById("ticketsBody");
const filterText = document.getElementById("filterText");
const filterStatus = document.getElementById("filterStatus");
const assetForm = document.getElementById("assetForm");
const assetsBody = document.getElementById("assetsBody");
const assetsKey = "azuos_ti_assets";

let allTickets = [];
let assets = loadAssets();

document.getElementById("btnLogout").addEventListener("click", () => {
  sessionStorage.removeItem("ti_logado");
  window.location.href = "login.html";
});

document.getElementById("btnRefresh").addEventListener("click", loadTickets);

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

function loadAssets() {
  try {
    return JSON.parse(localStorage.getItem(assetsKey)) || [];
  } catch (error) {
    return [];
  }
}

function saveAssets() {
  localStorage.setItem(assetsKey, JSON.stringify(assets));
}

async function loadTickets() {
  body.innerHTML = '<tr><td colspan="9">Carregando chamados...</td></tr>';
  const { data, error } = await client.from("chamados").select("*").order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="9">Erro ao carregar chamados: ${escapeHtml(error.message)}</td></tr>`;
    return;
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
  document.getElementById("statDevices").innerText = assets.length;
  document.getElementById("statAlerts").innerText = alerts.length;

  renderAlerts(alerts);
  renderBars("typeChart", topEntries(groupCount(monthTickets, (ticket) => ticket.tipo)));
  renderBars("deptChart", topEntries(groupCount(monthTickets, (ticket) => ticket.departamento)));
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

function renderBars(targetId, entries) {
  const target = document.getElementById(targetId);

  if (!entries.length) {
    target.innerHTML = '<div class="empty-state">Sem dados neste mes.</div>';
    return;
  }

  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  target.innerHTML = entries.map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-meta">
        <span>${escapeHtml(label)}</span>
        <strong>${count}</strong>
      </div>
      <div class="bar-track"><span style="width:${Math.max((count / max) * 100, 8)}%"></span></div>
    </div>
  `).join("");
}

function getAssetSignals(ownerName) {
  const name = normalizeText(ownerName);
  const monthTickets = allTickets.filter((ticket) => isThisMonth(ticket) && normalizeText(ticket.nome) === name);
  const byType = topEntries(groupCount(monthTickets, (ticket) => ticket.tipo), 1);

  return {
    monthCount: monthTickets.length,
    recurringType: byType.length && byType[0][1] >= 2 ? `${byType[0][0]} (${byType[0][1]})` : "-",
  };
}

function suggestedHealth(asset, monthCount) {
  if (asset.health === "Critica" || monthCount >= 5) return "Critica";
  if (asset.health === "Atencao" || monthCount >= 3) return "Atencao";
  return "Boa";
}

function renderAssets() {
  if (!assets.length) {
    assetsBody.innerHTML = '<tr><td colspan="8">Nenhum computador cadastrado ainda.</td></tr>';
    renderDashboard();
    return;
  }

  assetsBody.innerHTML = assets.map((asset) => {
    const signals = getAssetSignals(asset.owner);
    const health = suggestedHealth(asset, signals.monthCount);

    return `
      <tr>
        <td><strong>${escapeHtml(asset.owner)}</strong><br><span class="muted">${escapeHtml(asset.department || "-")}</span></td>
        <td>${escapeHtml(asset.computer)}</td>
        <td>${escapeHtml(asset.memory || "-")}</td>
        <td>${escapeHtml(asset.storage || "-")}</td>
        <td>${signals.monthCount}</td>
        <td>${escapeHtml(signals.recurringType)}</td>
        <td><span class="health-badge ${health.toLowerCase()}">${health}</span></td>
        <td class="table-actions">
          <button class="secondary small" onclick="editAsset('${asset.id}')">Editar</button>
          <button class="danger small" onclick="deleteAsset('${asset.id}')">Excluir</button>
        </td>
      </tr>
    `;
  }).join("");

  renderDashboard();
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

window.editAsset = function editAsset(id) {
  const asset = assets.find((item) => item.id === id);
  if (!asset) return;

  document.getElementById("assetId").value = asset.id;
  document.getElementById("assetOwner").value = asset.owner;
  document.getElementById("assetDept").value = asset.department || "";
  document.getElementById("assetComputer").value = asset.computer;
  document.getElementById("assetMemory").value = asset.memory || "";
  document.getElementById("assetStorage").value = asset.storage || "";
  document.getElementById("assetHealth").value = asset.health || "Boa";
  document.getElementById("btnSaveAsset").innerText = "Atualizar computador";
  document.getElementById("btnCancelAsset").classList.remove("hidden");
};

window.deleteAsset = function deleteAsset(id) {
  if (!confirm("Excluir este computador do inventario?")) return;
  assets = assets.filter((item) => item.id !== id);
  saveAssets();
  renderAssets();
};

function resetAssetForm() {
  assetForm.reset();
  document.getElementById("assetId").value = "";
  document.getElementById("btnSaveAsset").innerText = "Salvar computador";
  document.getElementById("btnCancelAsset").classList.add("hidden");
}

assetForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const id = document.getElementById("assetId").value || crypto.randomUUID();
  const asset = {
    id,
    owner: document.getElementById("assetOwner").value.trim(),
    department: document.getElementById("assetDept").value.trim(),
    computer: document.getElementById("assetComputer").value.trim(),
    memory: document.getElementById("assetMemory").value.trim(),
    storage: document.getElementById("assetStorage").value.trim(),
    health: document.getElementById("assetHealth").value,
  };

  assets = assets.some((item) => item.id === id)
    ? assets.map((item) => item.id === id ? asset : item)
    : [asset, ...assets];

  saveAssets();
  resetAssetForm();
  renderAssets();
});

document.getElementById("btnCancelAsset").addEventListener("click", resetAssetForm);
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

const form = document.getElementById("ticketForm");
const message = document.getElementById("message");
const btnSubmit = document.getElementById("btnSubmit");
const searchResult = document.getElementById("searchResult");

// Abertura e consulta passam pela funcao serverless (a tabela nao fica exposta).
const API_CHAMADO = "/api/chamado";

// Escapa texto antes de inserir no HTML (evita XSS a partir dos dados do chamado).
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// So aceita links http(s) (bloqueia javascript: e outros esquemas perigosos).
function safeUrl(url) {
  const value = String(url || "");
  return /^https?:\/\//i.test(value) ? value : "";
}

function showMessage(html, type = "success") {
  message.className = `message ${type}`;
  message.classList.remove("hidden");
  message.innerHTML = html;
}

function formatTicketNumber(value) {
  return "CH-" + String(value).padStart(4, "0");
}

async function uploadPrint(file, ticketId) {
  if (!file) return null;
  const ext = file.name.split(".").pop();
  const path = `prints/${ticketId}-${Date.now()}.${ext}`;
  const { error } = await client.storage.from("chamados-prints").upload(path, file);
  if (error) throw error;
  return client.storage.from("chamados-prints").getPublicUrl(path).data.publicUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  btnSubmit.disabled = true;
  btnSubmit.innerText = "Abrindo...";
  try {
    const file = document.getElementById("print").files[0];
    const ticketId = crypto.randomUUID();
    const printUrl = await uploadPrint(file, ticketId);
    const record = {
      nome: document.getElementById("nome").value.trim(),
      departamento: document.getElementById("departamento").value,
      tipo: document.getElementById("tipo").value,
      anydesk: document.getElementById("anydesk").value.trim(),
      descricao: document.getElementById("descricao").value.trim(),
      print_url: printUrl,
    };
    const response = await fetch(API_CHAMADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Erro ao abrir chamado");
    showMessage(`Chamado aberto com sucesso! Número: <strong>${escapeHtml(formatTicketNumber(result.chamado.id))}</strong>`);
    form.reset();
  } catch (err) {
    showMessage(`Erro ao abrir chamado: ${escapeHtml(err.message)}`, "error");
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = "➤ Abrir chamado";
  }
});

document.getElementById("btnSearch").addEventListener("click", async () => {
  const raw = document.getElementById("searchTicket").value.trim().toUpperCase();
  const id = Number(raw.replace("CH-", ""));
  if (!id) {
    searchResult.innerHTML = '<div class="ticket-card">Digite um chamado válido.</div>';
    return;
  }
  let data;
  try {
    const response = await fetch(`${API_CHAMADO}?numero=${id}`);
    if (!response.ok) throw new Error("nao encontrado");
    data = (await response.json()).chamado;
  } catch {
    searchResult.innerHTML = '<div class="ticket-card">Chamado não encontrado.</div>';
    return;
  }
  const link = safeUrl(data.print_url);
  const printLink = link
    ? `<br><br><a href="${escapeHtml(link)}" target="_blank" rel="noopener">Abrir print</a>`
    : "";
  searchResult.innerHTML = `<div class="ticket-card">
    <strong>${escapeHtml(formatTicketNumber(data.id))}</strong><br>
    <b>Status:</b> ${escapeHtml(data.status)}<br>
    <b>Nome:</b> ${escapeHtml(data.nome)}<br>
    <b>Departamento:</b> ${escapeHtml(data.departamento)}<br>
    <b>Tipo:</b> ${escapeHtml(data.tipo)}<br>
    <b>AnyDesk:</b> ${escapeHtml(data.anydesk || "Não informado")}<br>
    <b>Descrição:</b> ${escapeHtml(data.descricao)}<br>
    <b>Data:</b> ${escapeHtml(new Date(data.created_at).toLocaleString("pt-BR"))}${printLink}
  </div>`;
});

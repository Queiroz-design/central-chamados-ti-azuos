// Login do Painel do TI via Supabase Auth.
// Usuarios sao criados no Supabase (Authentication > Users).
// Pode-se logar com o e-mail completo OU com um usuario curto,
// que sera convertido para "<usuario>@azuos.local".
const LOGIN_DOMAIN = "azuos.local";

const form = document.getElementById("loginForm");
const message = document.getElementById("loginMessage");
const submitBtn = form.querySelector('button[type="submit"]');

function showError(text) {
  message.className = "message error";
  message.classList.remove("hidden");
  message.innerText = text;
}

// Se ja existe uma sessao valida, vai direto para o painel.
client.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.replace("admin.html");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const usuario = document.getElementById("usuario").value.trim();
  const senha = document.getElementById("senha").value;
  const email = usuario.includes("@") ? usuario : `${usuario}@${LOGIN_DOMAIN}`;

  const original = submitBtn.innerText;
  submitBtn.disabled = true;
  submitBtn.innerText = "Entrando...";

  const { error } = await client.auth.signInWithPassword({ email, password: senha });

  if (error) {
    showError("Usuário ou senha inválidos.");
    submitBtn.disabled = false;
    submitBtn.innerText = original;
    return;
  }

  window.location.replace("admin.html");
});

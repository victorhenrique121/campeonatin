const REMOTE_ERROR_PREFIX =
  /^Error invoking remote method '[^']+':\\s*(?:Error:\\s*)?/i;

const FRIENDLY_EMAIL_ERRORS = new Set([
  "Informe sua senha atual.",
  "Informe um e-mail válido.",
  "O novo e-mail deve ser diferente do e-mail atual.",
  "Sua sessão expirou. Entre novamente para alterar o e-mail.",
  "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  "O link de confirmação expirou. Solicite uma nova confirmação.",
  "Não foi possível solicitar essa alteração. Confira o endereço informado e tente novamente.",
  "Não há troca de e-mail pendente.",
  "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
  "Supabase não está configurado.",
]);

export function getFriendlyEmailSettingsError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.replace(REMOTE_ERROR_PREFIX, "").trim();

  if (FRIENDLY_EMAIL_ERRORS.has(message)) {
    return message;
  }

  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Senha atual incorreta.";
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("status code: 429")
  ) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }

  if (
    lower.includes("session") &&
    (lower.includes("missing") ||
      lower.includes("expired") ||
      lower.includes("not found") ||
      lower.includes("invalid"))
  ) {
    return "Sua sessão expirou. Entre novamente para alterar o e-mail.";
  }

  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("connection")
  ) {
    return "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.";
  }

  return "Algo deu errado. Tente novamente em instantes.";
}

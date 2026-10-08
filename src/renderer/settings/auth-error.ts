const REMOTE_ERROR_PREFIX =
  /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

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

type FriendlyErrorContext = "email-settings" | "privacy";

export function getFriendlyError(
  error: unknown,
  context: FriendlyErrorContext,
): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.replace(REMOTE_ERROR_PREFIX, "").trim();

  const knownErrors =
    context === "email-settings" ? FRIENDLY_EMAIL_ERRORS : FRIENDLY_PRIVACY_ERRORS;

  if (knownErrors.has(message)) {
    return message;
  }

  const lower = message.toLowerCase();

  if (context === "email-settings" && lower.includes("invalid login credentials")) {
    return "Senha atual incorreta.";
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("status code: 429")
  ) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }

  if (context === "email-settings" &&
    lower.includes("session") &&
    (lower.includes("missing") ||
      lower.includes("expired") ||
      lower.includes("not found") ||
      lower.includes("invalid"))
  ) {
    return "Sua sessão expirou. Entre novamente para alterar o e-mail.";
  }

  if (
    context === "privacy" &&
    lower.includes("session") &&
    (lower.includes("missing") ||
      lower.includes("expired") ||
      lower.includes("not found") ||
      lower.includes("invalid"))
  ) {
    return "Sua sessão expirou. Entre novamente para continuar.";
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

export function getFriendlyEmailSettingsError(error: unknown): string {
  return getFriendlyError(error, "email-settings");
}


const FRIENDLY_PRIVACY_ERRORS = new Set([
  "Sua sessão expirou. Entre novamente para continuar.",
  "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
  "Não foi possível encerrar as outras sessões. Tente novamente em instantes.",
  "Supabase não está configurado.",
]);

export function getFriendlyPrivacyError(error: unknown): string {
  return getFriendlyError(error, "privacy");
}

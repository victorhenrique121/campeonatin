import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { EMAIL_CONFIRMATION_REDIRECT_URL } from "../shared/auth-config";
import type { ChangeEmailInput, EmailSettings } from "../shared/api";

/**
 * ============================================================================
 * ETAPA 2 da migração SQLite -> Supabase/PostgreSQL: conexão + Auth.
 * ============================================================================
 * - O SQLite (better-sqlite3 via repository.ts) CONTINUA sendo o banco
 *   principal do aplicativo: teams, matches, championships, fixtures, ranking,
 *   dashboard e game rules permanecem 100% locais. Apenas "players" passa a
 *   ter o Supabase como fonte de verdade (veja players-service.ts), com
 *   espelho local no SQLite para preservar FKs/JOINs das demais entidades.
 * - Este módulo vive exclusivamente no processo MAIN do Electron. As
 *   credenciais nunca são expostas ao renderer.
 * - Usa somente a chave PÚBLICA (anon) + login de uma CONTA DE SERVIÇO do
 *   aplicativo via Supabase Auth (e-mail/senha no .env local). A service_role
 *   NÃO é lida nem utilizada em hipótese alguma.
 * - A ausência de configuração é tolerada: sem .env, o aplicativo funciona
 *   exatamente como antes, 100% SQLite.
 */

export type SupabaseConnectionReason =
  | "connected"
  | "not-configured"
  | "table-missing"
  | "invalid-credentials"
  | "unreachable"
  | "error";

export type SupabaseConnectionStatus = {
  ok: boolean;
  reason: SupabaseConnectionReason;
  message: string;
  /** Amostra de linhas retornada pela consulta de teste (quando houver). */
  rows?: Array<{ id: number }>;
  /** Etapa 2: true quando há sessão ativa da conta de serviço. */
  authenticated?: boolean;
};

export type SupabaseAuthReason =
  | "signed-in"
  | "not-configured"
  | "no-service-account"
  | "invalid-credentials"
  | "unreachable"
  | "error";

export type SupabaseAuthStatus = {
  ok: boolean;
  reason: SupabaseAuthReason;
  message: string;
  email?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "player" | "viewer";
  emailConfirmedAt: string | null;
};

export type AuthSessionStatus = {
  authenticated: boolean;
  user: AuthUser | null;
};

export type AuthSignUpResult = {
  requiresEmailConfirmation: boolean;
  email: string;
};

export type UserProfile = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: "admin" | "player" | "viewer";
  email: string;
  emailConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const LOG_PREFIX = "[supabase]";
const SERVICE_ROLE_ENV_VAR = "SUPABASE_SERVICE_ROLE_KEY";
const APP_EMAIL_ENV_VAR = "SUPABASE_APP_EMAIL";
const APP_PASSWORD_ENV_VAR = "SUPABASE_APP_PASSWORD";
const MIGRATION_FILE = "supabase/migrations/20260827160000_initial_schema.sql";
/** Assinaturas típicas de falha de rede/DNS/timeout (fetch nativo do Node). */
const NETWORK_ERROR_PATTERN =
  /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|aborted|timeout|network/i;
/**
 * Guarda de tempo limite para chamadas HTTP: sem conexão, uma operação não
 * pode travar por minutos — falha rápido e o fallback gracioso assume.
 */
const FETCH_TIMEOUT_MS = 10_000;

let client: SupabaseClient | null = null;
/** Cliente separado para a sessão do usuário final. */
let userAuthClient: SupabaseClient | null = null;
let initialized = false;

/** Indica se a mensagem de erro corresponde a falha de rede/timeout. */
export function isNetworkErrorMessage(message: string): boolean {
  return NETWORK_ERROR_PATTERN.test(message);
}

/**
 * Carrega um arquivo `.env` para o processo principal usando o suporte
 * nativo do Node (`process.loadEnvFile`) — sem dependência extra (dotenv).
 * Variáveis já definidas no ambiente têm precedência sobre o arquivo.
 * Qualquer falha aqui é ignorada de propósito: `.env` é opcional e nunca
 * pode impedir o aplicativo de iniciar.
 */
export function loadDotEnv(rootDir?: string): string | null {
  const candidates = [
    rootDir ? path.join(rootDir, ".env") : null,
    path.join(process.cwd(), ".env"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        process.loadEnvFile(candidate);
        return candidate;
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} não foi possível carregar ${candidate}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

/**
 * Armazenamento de sessão backed por arquivo JSON (pasta userData), para que
 * o login da conta de serviço sobreviva a reinicializações do app sem novo
 * signIn a cada boot. Substitui o localStorage (que não existe no main).
 */
function createFileStorage(file: string) {
  const readAll = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const writeAll = (all: Record<string, string>) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all), "utf8");
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} falha ao persistir a sessão em ${file}:`,
        err instanceof Error ? err.message : err,
      );
    }
  };
  return {
    getItem: (key: string) => readAll()[key] ?? null,
    setItem: (key: string, value: string) => {
      const all = readAll();
      all[key] = value;
      writeAll(all);
    },
    removeItem: (key: string) => {
      const all = readAll();
      delete all[key];
      writeAll(all);
    },
  };
}

/**
 * Cria o cliente Supabase uma única vez (lazy/idempotente), lendo
 * SUPABASE_URL e SUPABASE_ANON_KEY do ambiente (com `.env` como fallback
 * em desenvolvimento). Retorna `null` quando não configurado — o app segue
 * com o SQLite normalmente.
 *
 * `sessionStoragePath` ativa a persistência de sessão (Auth) em arquivo;
 * deve apontar para a pasta userData do Electron (processo main).
 */
export function initSupabase(
  options: { rootDir?: string; sessionStoragePath?: string } = {},
): SupabaseClient | null {
  if (initialized) return client;
  initialized = true;

  loadDotEnv(options.rootDir);

  // Segurança: a service_role jamais deve existir no app distribuído.
  // Este código NÃO a utiliza; o aviso ajuda a removê-la do ambiente.
  if (process.env[SERVICE_ROLE_ENV_VAR]) {
    console.warn(
      `${LOG_PREFIX} AVISO: a variável ${SERVICE_ROLE_ENV_VAR} está presente no ambiente. ` +
        "Ela NÃO é utilizada pelo aplicativo e nunca deve ser empacotada/distribuída — remova-a do .env.",
    );
  }

  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    console.warn(
      `${LOG_PREFIX} Supabase não configurado (SUPABASE_URL e/ou SUPABASE_ANON_KEY ausentes). ` +
        "Copie .env.example para .env e preencha os valores do seu projeto. " +
        "O aplicativo seguirá funcionando normalmente no modo SQLite local.",
    );
    return null;
  }

  try {
    const globalOptions = {
      global: {
        // Timeout: evita travar operações quando não há conectividade.
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
          }),
      },
    };

    client = createClient(url, anonKey, {
      ...globalOptions,
      auth: options.sessionStoragePath
        ? {
            persistSession: true,
            autoRefreshToken: true,
            storage: createFileStorage(options.sessionStoragePath),
          }
        : {
            persistSession: false,
            autoRefreshToken: false,
          },
    });

    // Sessão do usuário final fica separada da conta de serviço legada.
    // Isso permite adicionar login/cadastro agora sem quebrar a sincronização
    // existente do FC Arena. A lógica de ownership será migrada depois.
    const userSessionPath = options.sessionStoragePath
      ? path.join(path.dirname(options.sessionStoragePath), "fcarena-user-session.json")
      : undefined;

    userAuthClient = createClient(url, anonKey, {
      ...globalOptions,
      auth: userSessionPath
        ? {
            persistSession: true,
            autoRefreshToken: true,
            storage: createFileStorage(userSessionPath),
          }
        : {
            persistSession: false,
            autoRefreshToken: false,
          },
    });

    console.info(`${LOG_PREFIX} clientes Supabase criados para ${url} (chave anon pública).`);
    return client;
  } catch (err) {
    client = null;
    console.error(
      `${LOG_PREFIX} falha ao criar o cliente Supabase (verifique SUPABASE_URL/SUPABASE_ANON_KEY):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}


/** Retorna o cliente de Auth da sessão do usuário final. */
function getUserAuthClient(): SupabaseClient | null {
  if (!userAuthClient) initSupabase();
  return userAuthClient;
}

function normalizeAuthError(
  error: { message?: string; code?: string; status?: number } | null,
  context: "default" | "password-change" | "email-change" = "default",
): Error {
  const message = error?.message || "Não foi possível concluir a operação de autenticação.";
  const lower = message.toLowerCase();

  if (isNetworkErrorMessage(message)) {
    return new Error("Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.");
  }

  if (context === "session-management") {
    if (/session|jwt|refresh token|not found|expired|invalid/i.test(message)) {
      return "Sua sessão expirou. Entre novamente para continuar.";
    }
    if (/rate limit|too many|429/i.test(message)) {
      return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    }
    if (/network|fetch failed|failed to fetch|connection/i.test(message)) {
      return "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.";
    }
    return "Não foi possível encerrar as outras sessões. Tente novamente em instantes.";
  }

  if (context === "email-change") {
    if (
      lower.includes("session") &&
      (lower.includes("missing") ||
        lower.includes("expired") ||
        lower.includes("not found") ||
        lower.includes("invalid"))
    ) {
      return new Error("Sua sessão expirou. Entre novamente para alterar o e-mail.");
    }
    if (
      lower.includes("rate limit") ||
      lower.includes("too many requests") ||
      error?.status === 429
    ) {
      return new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    }
    if (
      lower.includes("expired") &&
      (lower.includes("link") || lower.includes("token") || lower.includes("otp"))
    ) {
      return new Error("O link de confirmação expirou. Solicite uma nova confirmação.");
    }
    if (
      lower.includes("already registered") ||
      lower.includes("already been registered") ||
      lower.includes("email already") ||
      lower.includes("email_exists") ||
      lower.includes("email exists")
    ) {
      return new Error("Não foi possível solicitar essa alteração. Confira o endereço informado e tente novamente.");
    }
    return new Error("Algo deu errado. Tente novamente em instantes.");
  }

  if (context === "password-change") {
    if (
      lower.includes("session") &&
      (lower.includes("missing") ||
        lower.includes("expired") ||
        lower.includes("not found") ||
        lower.includes("invalid"))
    ) {
      return new Error("Sua sessão expirou. Entre novamente para alterar a senha.");
    }
    if (
      lower.includes("rate limit") ||
      lower.includes("too many requests") ||
      error?.status === 429
    ) {
      return new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    }
    if (
      lower.includes("weak password") ||
      lower.includes("password is too weak") ||
      lower.includes("password should")
    ) {
      return new Error("A nova senha não atende aos requisitos de segurança configurados.");
    }
    if (
      lower.includes("current password") ||
      lower.includes("reauthentication") ||
      lower.includes("nonce")
    ) {
      return new Error("Não foi possível confirmar sua identidade para alterar a senha.");
    }
    return new Error("Algo deu errado. Tente novamente em instantes.");
  }

  if (lower.includes("email not confirmed")) {
    return new Error("Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada e confirme o endereço antes de entrar.");
  }
  if (lower.includes("invalid login credentials")) {
    return new Error("E-mail ou senha incorretos.");
  }
  if (lower.includes("password should be at least")) {
    return new Error("A senha é muito curta. Use pelo menos 8 caracteres.");
  }
  if (lower.includes("rate limit")) {
    return new Error("Muitas tentativas de e-mail. Aguarde alguns minutos e tente novamente.");
  }
  return new Error(message);
}

function logSafeAuthError(operation: string, error: { message?: string; code?: string; status?: number }) {
  console.error(`${LOG_PREFIX} ${operation}:`, {
    name: error.constructor?.name,
    code: error.code,
    status: error.status,
    message: error.message,
  });
}

async function getAuthUserFromSession(): Promise<AuthUser | null> {
  const supabase = getUserAuthClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const user = data.user;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name,role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.warn(`${LOG_PREFIX} não foi possível carregar o profile do usuário:`, profileError.message);
  }

  const displayName =
    (profile?.display_name as string | undefined)?.trim() ||
    (user.user_metadata?.display_name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Usuário";

  const roleValue = profile?.role;
  const role: AuthUser["role"] =
    roleValue === "admin" || roleValue === "player" || roleValue === "viewer"
      ? roleValue
      : "viewer";

  return {
    id: user.id,
    email: user.email ?? "",
    displayName,
    role,
    emailConfirmedAt: user.email_confirmed_at ?? null,
  };
}

/** Retorna a sessão do usuário final atualmente conectado ao FC Arena. */
export async function getAuthSession(): Promise<AuthSessionStatus> {
  const user = await getAuthUserFromSession();
  return { authenticated: Boolean(user), user };
}

/** Lê somente o perfil do usuário autenticado e os metadados públicos de Auth necessários à página Meu perfil. */
export async function getProfile(): Promise<UserProfile> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw normalizeAuthError(authError);
  }

  const user = authData.user;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,display_name,username,avatar_url,bio,role,created_at,updated_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error(
      profileError?.message || "Não foi possível carregar seu perfil.",
    );
  }

  const roleValue = profile.role;
  const role: UserProfile["role"] =
    roleValue === "admin" || roleValue === "player" || roleValue === "viewer"
      ? roleValue
      : "viewer";

  return {
    id: profile.id,
    displayName: profile.display_name,
    username: profile.username,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    role,
    email: user.email ?? "",
    emailConfirmedAt: user.email_confirmed_at ?? null,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export type UpdateProfileInput = {
  displayName: string;
  username: string | null;
  bio: string | null;
  avatar?: {
    bytes: Uint8Array;
    contentType: "image/jpeg" | "image/png" | "image/webp";
    extension: "jpg" | "png" | "webp";
  } | null;
};

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const normalized = username.trim().toLowerCase();
  const { data, error } = await supabase.rpc("is_username_available", {
    p_username: normalized,
  });

  if (error) throw new Error("Não foi possível verificar a disponibilidade do username.");
  return data === true;
}

function avatarPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/avatars/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

export async function updateProfile(input: UpdateProfileInput): Promise<UserProfile> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw normalizeAuthError(authError);

  const user = authData.user;
  const displayName = input.displayName.trim();
  const username = input.username?.trim().toLowerCase() || null;
  const bio = input.bio?.trim() || null;

  if (!displayName) throw new Error("Informe o nome de exibição.");
  if (displayName.length > 80) throw new Error("O nome de exibição deve ter no máximo 80 caracteres.");
  if (username && !/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new Error("O username deve ter de 3 a 20 caracteres: letras minúsculas, números ou _.");
  }
  if (bio && bio.length > 160) throw new Error("A bio deve ter no máximo 160 caracteres.");

  if (username) {
    const { data: available, error } = await supabase.rpc("is_username_available", {
      p_username: username,
    });
    if (error) throw new Error("Não foi possível verificar a disponibilidade do username.");
    if (available !== true) {
      const { data: current } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      if ((current?.username ?? null) !== username) {
        throw new Error("Esse username já está em uso.");
      }
    }
  }

  const { data: currentProfile, error: currentError } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .single();

  if (currentError || !currentProfile) {
    throw new Error("Não foi possível carregar o perfil atual.");
  }

  let avatarUrl: string | null | undefined = undefined;
  let newAvatarPath: string | null = null;
  const oldAvatarPath = avatarPathFromUrl(currentProfile.avatar_url);

  if (input.avatar) {
    newAvatarPath = `${user.id}/avatar.${input.avatar.extension}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(newAvatarPath, input.avatar.bytes, {
        contentType: input.avatar.contentType,
        upsert: true,
        cacheControl: "3600",
      });

    if (uploadError) {
      throw new Error(`Não foi possível enviar o avatar: ${uploadError.message}`);
    }

    const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(newAvatarPath);
    avatarUrl = publicUrl.publicUrl;
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      username,
      bio,
      updated_at: new Date().toISOString(),
      ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
    })
    .eq("id", user.id)
    .select("id,display_name,username,avatar_url,bio,role,created_at,updated_at")
    .single();

  if (updateError || !updated) {
    if (newAvatarPath) {
      await supabase.storage.from("avatars").remove([newAvatarPath]).catch(() => undefined);
    }
    throw new Error(updateError?.message || "Não foi possível salvar o perfil.");
  }

  if (newAvatarPath && oldAvatarPath && oldAvatarPath !== newAvatarPath) {
    await supabase.storage.from("avatars").remove([oldAvatarPath]);
  }

  const roleValue = updated.role;
  const role: UserProfile["role"] =
    roleValue === "admin" || roleValue === "player" || roleValue === "viewer"
      ? roleValue
      : "viewer";

  return {
    id: updated.id,
    displayName: updated.display_name,
    username: updated.username,
    avatarUrl: updated.avatar_url,
    bio: updated.bio,
    role,
    email: user.email ?? "",
    emailConfirmedAt: user.email_confirmed_at ?? null,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  };
}

/** Cadastro com e-mail, senha e nome. O trigger do banco cria o profile. */
export async function signUpUser(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthSignUpResult> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = displayName.trim();

  if (!normalizedName) throw new Error("Informe seu nome.");
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error("Informe um e-mail válido.");
  }
  if (password.length < 8) {
    throw new Error("A senha deve ter pelo menos 8 caracteres.");
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: { display_name: normalizedName },
      emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL,
    },
  });

  if (error) throw normalizeAuthError(error);

  return {
    requiresEmailConfirmation: !data.session,
    email: normalizedEmail,
  };
}

/** Login do usuário final. O Supabase bloqueia usuários não confirmados. */
export async function signInUser(
  email: string,
  password: string,
): Promise<AuthUser> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new Error("Informe e-mail e senha.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) throw normalizeAuthError(error);
  if (!data.user) throw new Error("Não foi possível identificar o usuário.");

  const user = await getAuthUserFromSession();
  if (!user) throw new Error("Login realizado, mas o perfil do usuário não pôde ser carregado.");
  return user;
}

/** Reenvia o e-mail de confirmação do cadastro. */
export async function resendSignupConfirmation(email: string): Promise<void> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Informe seu e-mail.");

  const { data, error } = await supabase.auth.resend({
    type: "signup",
    email: normalizedEmail,
    options: {
      emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL,
    },
  });

  // Registra somente metadados técnicos da resposta. Nunca registra o e-mail,
  // tokens, links de confirmação ou o conteúdo completo do objeto de usuário.
  if (error) {
    console.error(`${LOG_PREFIX} falha no reenvio de confirmação:`, {
      name: error.name,
      code: error.code,
      status: error.status,
      message: error.message,
    });
    throw normalizeAuthError(error);
  }

  console.info(`${LOG_PREFIX} reenvio de confirmação aceito pelo Auth:`, {
    hasMessageId: Boolean(data?.messageId),
  });
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw normalizeAuthError(error, "email-change");
  }

  return {
    email: data.user.email ?? "",
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
    pendingEmail: data.user.new_email ?? null,
  };
}

export async function changeEmail(
  input: ChangeEmailInput,
): Promise<EmailSettings> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const currentPassword = input.currentPassword;
  const normalizedEmail = input.newEmail.trim().toLowerCase();

  if (!currentPassword) throw new Error("Informe sua senha atual.");
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error("Informe um e-mail válido.");
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user?.email) {
    if (authError) {
      logSafeAuthError("não foi possível obter a sessão para alterar o e-mail", authError);
      throw normalizeAuthError(authError, "email-change");
    }
    throw new Error("Sua sessão expirou. Entre novamente para alterar o e-mail.");
  }

  const currentEmail = authData.user.email.trim().toLowerCase();
  if (normalizedEmail === currentEmail) {
    throw new Error("O novo e-mail deve ser diferente do e-mail atual.");
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: currentEmail,
    password: currentPassword,
  });

  if (reauthError) {
    logSafeAuthError("reautenticação para alteração de e-mail recusada", reauthError);

    if (/invalid login credentials/i.test(reauthError.message)) {
      throw new Error("Senha atual incorreta.");
    }

    throw normalizeAuthError(reauthError, "email-change");
  }

  const { error: updateError } = await supabase.auth.updateUser(
    { email: normalizedEmail },
    { emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL },
  );

  if (updateError) {
    logSafeAuthError("falha ao solicitar alteração de e-mail", updateError);
    throw normalizeAuthError(updateError, "email-change");
  }

  return getEmailSettings();
}

export async function resendEmailChangeConfirmation(
  pendingEmail: string,
): Promise<void> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const normalizedEmail = pendingEmail.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Não há troca de e-mail pendente.");

  const { error } = await supabase.auth.resend({
    type: "email_change",
    email: normalizedEmail,
  });

  if (error) {
    logSafeAuthError("falha no reenvio da confirmação de troca de e-mail", error);
    throw normalizeAuthError(error, "email-change");
  }
}

/** Altera a senha do usuário final após reautenticar com a senha atual. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  if (!currentPassword) {
    throw new Error("Informe sua senha atual.");
  }
  if (newPassword.length < 8) {
    throw new Error("A nova senha deve ter pelo menos 8 caracteres.");
  }
  if (newPassword === currentPassword) {
    throw new Error("A nova senha deve ser diferente da senha atual.");
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user?.email) {
    if (authError) {
      logSafeAuthError("não foi possível obter a sessão para alterar a senha", authError);
      throw normalizeAuthError(authError, "password-change");
    }
    throw new Error("Sua sessão expirou. Entre novamente para alterar a senha.");
  }

  const email = authData.user.email.trim().toLowerCase();

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });

  if (reauthError) {
    logSafeAuthError("reautenticação para alteração de senha recusada", reauthError);

    if (/invalid login credentials/i.test(reauthError.message)) {
      throw new Error("Senha atual incorreta.");
    }

    throw normalizeAuthError(reauthError, "password-change");
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    logSafeAuthError("falha ao atualizar senha", updateError);
    throw normalizeAuthError(updateError, "password-change");
  }

  const { error: signOutOthersError } = await supabase.auth.signOut({
    scope: "others",
  });

  if (signOutOthersError) {
    logSafeAuthError("falha ao encerrar outras sessões após alteração de senha", signOutOthersError);
    const friendly = normalizeAuthError(signOutOthersError, "password-change");
    throw new Error(
      friendly.message === "Algo deu errado. Tente novamente em instantes."
        ? "Senha alterada, mas não foi possível encerrar as outras sessões. Tente novamente em instantes."
        : friendly.message,
    );
  }
}

/** Encerra somente a sessão do usuário final. */
export async function endOtherSessions(): Promise<void> {
  const supabase = getUserAuthClient();
  if (!supabase) throw new Error("Supabase não está configurado.");

  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    logSafeAuthError("falha ao encerrar outras sessões", error);
    throw normalizeAuthError(error, "session-management");
  }
}

export async function signOutUser(): Promise<void> {
  const supabase = getUserAuthClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw normalizeAuthError(error);
}

/** Retorna o cliente já inicializado, ou `null` se não configurado. */
export function getSupabase(): SupabaseClient | null {
  return client;
}

/** True quando URL + chave anon estão configuradas (cliente criado). */
export function isSupabaseConfigured(): boolean {
  return client !== null;
}

/** Credenciais da conta de serviço do aplicativo (Supabase Auth), se houver. */
function getServiceAccount(): { email: string; password: string } | null {
  const email = process.env[APP_EMAIL_ENV_VAR]?.trim();
  const password = process.env[APP_PASSWORD_ENV_VAR];
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Garante uma sessão 'authenticated' no Supabase usando a conta de serviço
 * do aplicativo (RLS exige esse papel para ler/gravar players).
 *
 * - `force: true` força novo signInWithPassword (usado após sessão recusada).
 * - Nunca lança: devolve status classificado para o chamador decidir.
 */
export async function ensureAuthenticated(
  options: { force?: boolean } = {},
): Promise<SupabaseAuthStatus> {
  const supabase = initSupabase();
  if (!supabase) {
    return {
      ok: false,
      reason: "not-configured",
      message:
        "Supabase não configurado (.env ausente ou incompleto). O aplicativo está no modo SQLite local.",
    };
  }

  const account = getServiceAccount();
  if (!account) {
    return {
      ok: false,
      reason: "no-service-account",
      message:
        `Conta de serviço não configurada (${APP_EMAIL_ENV_VAR}/${APP_PASSWORD_ENV_VAR} ausentes no .env). ` +
        "Leituras de players usarão o espelho local; criações/edições/exclusões ficam bloqueadas até configurar.",
    };
  }

  try {
    if (!options.force) {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data.session) {
        return {
          ok: true,
          reason: "signed-in",
          message: `Sessão Supabase ativa (${account.email}).`,
          email: account.email,
        };
      }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (error) {
      if (/invalid login credentials/i.test(error.message)) {
        return {
          ok: false,
          reason: "invalid-credentials",
          message:
            `Credenciais da conta de serviço recusadas pelo Supabase. Verifique ${APP_EMAIL_ENV_VAR}/${APP_PASSWORD_ENV_VAR} no .env ` +
            "e confirme que o usuário existe em Authentication > Users (com e-mail confirmado).",
        };
      }
      if (isNetworkErrorMessage(error.message)) {
        return {
          ok: false,
          reason: "unreachable",
          message: `Não foi possível alcançar o Supabase para autenticar: ${error.message}`,
        };
      }
      return {
        ok: false,
        reason: "error",
        message: `Erro ao autenticar no Supabase: ${error.message}`,
      };
    }

    return {
      ok: true,
      reason: "signed-in",
      message: `Login da conta de serviço realizado (${account.email}).`,
      email: account.email,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNetworkErrorMessage(message)) {
      return {
        ok: false,
        reason: "unreachable",
        message: `Não foi possível alcançar o Supabase para autenticar: ${message}`,
      };
    }
    return {
      ok: false,
      reason: "error",
      message: `Falha inesperada ao autenticar no Supabase: ${message}`,
    };
  }
}

/**
 * Teste de conexão SOMENTE LEITURA e não destrutivo.
 *
 * - NÃO cria tabelas nem esquemas automaticamente. Se `public.players` não
 *   existir, o resultado informa que é preciso aplicar a migration
 *   {@link MIGRATION_FILE} no SQL Editor.
 * - Etapa 2: quando a conta de serviço está configurada, o teste também
 *   valida o login (RLS exige sessão 'authenticated' para ler players).
 * - Nunca lança exceção: sempre devolve um status classificável, para que o
 *   boot do aplicativo jamais seja interrompido por causa do Supabase.
 */
export async function testSupabaseConnection(): Promise<SupabaseConnectionStatus> {
  const supabase = initSupabase();
  if (!supabase) {
    return {
      ok: false,
      reason: "not-configured",
      message:
        "Supabase não configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY no arquivo .env " +
        "(veja .env.example). O SQLite continua sendo o banco principal do aplicativo.",
    };
  }

  // Autentica a conta de serviço (quando configurada) antes de testar a
  // leitura: com RLS, 'anon' não lê public.players — o app real lê autenticado.
  const auth = await ensureAuthenticated();
  if (!auth.ok && auth.reason !== "no-service-account") {
    const reason: SupabaseConnectionReason =
      auth.reason === "invalid-credentials" || auth.reason === "unreachable"
        ? auth.reason
        : "error";
    return { ok: false, reason, message: auth.message, authenticated: false };
  }

  try {
    const { data, error } = await supabase
      .from("players")
      .select("id")
      .limit(1);

    if (error) {
      // PGRST205: a tabela não existe no schema cache do PostgREST.
      if (error.code === "PGRST205") {
        return {
          ok: false,
          reason: "table-missing",
          message:
            "Conexão e credenciais OK, mas a tabela public.players não existe neste projeto Supabase. " +
            `Aplique a migration ${MIGRATION_FILE} no SQL Editor do Supabase. ` +
            "Nenhuma tabela foi criada automaticamente pelo aplicativo.",
          authenticated: auth.ok,
        };
      }
      // PGRST301 / mensagens de JWT: chave/sessão inválida ou expirada.
      if (error.code === "PGRST301" || /jwt|apikey|unauthorized/i.test(error.message)) {
        return {
          ok: false,
          reason: "invalid-credentials",
          message:
            `Credenciais recusadas pelo Supabase (chave anon ou sessão inválida?): ${error.message}` +
            (error.code ? ` (código: ${error.code})` : ""),
          authenticated: false,
        };
      }
      if (isNetworkErrorMessage(error.message)) {
        return {
          ok: false,
          reason: "unreachable",
          message: `Não foi possível alcançar o Supabase (verifique SUPABASE_URL e a conexão de rede): ${error.message}`,
          authenticated: auth.ok,
        };
      }
      return {
        ok: false,
        reason: "error",
        message: `Erro ao consultar o Supabase: ${error.message} (código: ${error.code || "n/d"})`,
        authenticated: auth.ok,
      };
    }

    const rows = (data ?? []) as Array<{ id: number }>;
    return {
      ok: true,
      reason: "connected",
      message: auth.ok
        ? `Conexão com o Supabase funcionando e autenticada como ${auth.email}: ` +
          `public.players respondeu com ${rows.length} linha(s) de amostra.`
        : rows.length > 0
          ? `Conexão com o Supabase funcionando: public.players retornou ${rows.length} linha(s) de amostra.`
          : "Conexão com o Supabase funcionando: public.players existe e respondeu com 0 linhas. " +
            "Resultado esperado para a chave anon sem conta de serviço configurada (RLS libera leitura apenas ao papel 'authenticated').",
      rows,
      authenticated: auth.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNetworkErrorMessage(message)) {
      return {
        ok: false,
        reason: "unreachable",
        message: `Não foi possível alcançar o Supabase (verifique SUPABASE_URL e a conexão de rede): ${message}`,
        authenticated: auth.ok,
      };
    }
    return {
      ok: false,
      reason: "error",
      message: `Falha inesperada no teste de conexão: ${message}`,
      authenticated: auth.ok,
    };
  }
}

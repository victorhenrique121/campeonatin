import { describe, expect, it } from "vitest";
import {
  getFriendlyEmailSettingsError,
  getFriendlyError,
  getFriendlyPrivacyError,
} from "./auth-error";

describe("mensagens amigáveis de erro", () => {
  it("remove o prefixo técnico do IPC", () => {
    expect(
      getFriendlyEmailSettingsError(
        new Error("Error invoking remote method 'auth:change-email': Error: Informe um e-mail válido."),
      ),
    ).toBe("Informe um e-mail válido.");
  });

  it("traduz erros de sessão conforme o contexto", () => {
    expect(getFriendlyError(new Error("session expired"), "email-settings")).toBe(
      "Sua sessão expirou. Entre novamente para alterar o e-mail.",
    );
    expect(getFriendlyPrivacyError(new Error("session expired"))).toBe(
      "Sua sessão expirou. Entre novamente para continuar.",
    );
  });

  it("não mostra detalhes desconhecidos", () => {
    expect(getFriendlyError(new Error("unexpected provider response"), "privacy")).toBe(
      "Algo deu errado. Tente novamente em instantes.",
    );
  });
});

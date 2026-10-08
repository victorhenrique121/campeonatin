import { describe, expect, it } from "vitest";
import {
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
  validatePasswordChange,
} from "./validation";

describe("validações de conta", () => {
  it("normaliza usernames e aceita somente o formato permitido", () => {
    expect(normalizeUsername("  Arena_Player  ")).toBe("arena_player");
    expect(isValidUsername("arena_player")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("arena-player")).toBe(false);
  });

  it("normaliza e valida e-mails", () => {
    expect(normalizeEmail("  JOGADOR@EXEMPLO.COM ")).toBe("jogador@exemplo.com");
    expect(isValidEmail("jogador@exemplo.com")).toBe(true);
    expect(isValidEmail("jogador@exemplo")).toBe(false);
  });

  it("informa cada condição da troca de senha", () => {
    expect(validatePasswordChange("atual", "nova1234", "nova1234")).toEqual({
      currentFilled: true,
      minimumLength: true,
      confirmationMatches: true,
      differentFromCurrent: true,
    });
    expect(validatePasswordChange("atual", "curta", "outra")).toEqual({
      currentFilled: true,
      minimumLength: false,
      confirmationMatches: false,
      differentFromCurrent: true,
    });
  });
});

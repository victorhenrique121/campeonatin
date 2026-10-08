export const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase();

export const isValidUsername = (value: string): boolean =>
  /^[a-z0-9_]{3,20}$/.test(value);

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const isValidEmail = (value: string): boolean => /^\S+@\S+\.\S+$/.test(value);

export type PasswordValidation = {
  currentFilled: boolean;
  minimumLength: boolean;
  confirmationMatches: boolean;
  differentFromCurrent: boolean;
};

export const validatePasswordChange = (
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): PasswordValidation => ({
  currentFilled: currentPassword.length > 0,
  minimumLength: newPassword.length >= 8,
  confirmationMatches: confirmation.length > 0 && confirmation === newPassword,
  differentFromCurrent: newPassword.length > 0 && newPassword !== currentPassword,
});

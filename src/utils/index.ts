export function createPageUrl(pageName: string) {
    return '/' + pageName.replace(/ /g, '-');
}

export const PASSWORD_RULES = [
  { id: 'length',    label: 'At least 8 characters',          test: (p: string) => p.length >= 8 },
  { id: 'upper',     label: 'One uppercase letter (A–Z)',      test: (p: string) => /[A-Z]/.test(p) },
  { id: 'lower',     label: 'One lowercase letter (a–z)',      test: (p: string) => /[a-z]/.test(p) },
  { id: 'number',    label: 'One number (0–9)',                test: (p: string) => /[0-9]/.test(p) },
  { id: 'special',   label: 'One special character (!@#$…)',   test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
];

export function checkPassword(password: string): { valid: boolean; failed: string[] } {
  const failed = PASSWORD_RULES.filter(r => !r.test(password)).map(r => r.id);
  return { valid: failed.length === 0, failed };
}
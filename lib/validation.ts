export const validateEmail = (email: string): { isValid: boolean; error?: string } => {
  if (!email || !email.trim()) {
    return { isValid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(email.trim())) {
    return { isValid: false, error: 'Please enter a valid email address' };
  }

  return { isValid: true };
};

/**
 * Normalize decimal input to handle different locale formats.
 * Replaces commas with dots (for German/European keyboards).
 * Handles both comma and dot decimal separators from any locale.
 */
export const normalizeDecimalInput = (text: string): string => {
  return text.replace(/,/g, '.');
};

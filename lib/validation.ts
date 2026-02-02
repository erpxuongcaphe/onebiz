// Validation utilities for authentication and user input

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
}

/**
 * Validate Vietnam phone number format
 * Accepts: 0xxxxxxxxx or +84xxxxxxxxx
 * Valid prefixes: 03, 05, 07, 08, 09
 */
export function validatePhone(phone: string): boolean {
  // Remove spaces, dashes, parentheses
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Vietnam phone regex: (0|+84)(3|5|7|8|9)[0-9]{8}
  const vnPhoneRegex = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/;
  return vnPhoneRegex.test(cleaned);
}

/**
 * Normalize phone number to standard format (0xxxxxxxxx)
 */
export function normalizePhone(phone: string): string {
  // Remove spaces, dashes, parentheses
  let normalized = phone.replace(/[\s\-\(\)]/g, '');

  // Convert +84 to 0
  if (normalized.startsWith('+84')) {
    normalized = '0' + normalized.substring(3);
  }

  return normalized;
}

/**
 * Detect if input string is email or phone number
 */
export function detectLoginType(input: string): 'email' | 'phone' {
  // If contains @, it's email
  if (input.includes('@')) {
    return 'email';
  }

  // If only contains digits, spaces, +, -, (), it might be phone
  const phonePattern = /^[\d\s\-\+\(\)]+$/;
  if (phonePattern.test(input)) {
    return 'phone';
  }

  // Default to email
  return 'email';
}

/**
 * Validate password strength
 * Returns validation result with errors and strength level
 */
export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong';
} {
  const errors: string[] = [];

  // Check minimum length
  if (password.length < 8) {
    errors.push('Tối thiểu 8 ký tự');
  }

  // Check for uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push('Phải có chữ hoa');
  }

  // Check for lowercase letter
  if (!/[a-z]/.test(password)) {
    errors.push('Phải có chữ thường');
  }

  // Check for number
  if (!/[0-9]/.test(password)) {
    errors.push('Phải có số');
  }

  // Determine strength
  let strength: 'weak' | 'medium' | 'strong' = 'weak';

  if (errors.length === 0) {
    // Strong: 12+ chars with special character
    if (password.length >= 12 && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      strength = 'strong';
    }
    // Medium: 10+ chars
    else if (password.length >= 10) {
      strength = 'medium';
    }
    // Weak but valid: 8-9 chars
    else {
      strength = 'weak';
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    strength
  };
}

/**
 * Generate a random secure password
 */
export function generateRandomPassword(length: number = 12): string {
  // Exclude confusing characters: 0, O, 1, l, I
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  let password = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    password += chars.charAt(randomIndex);
  }

  return password;
}

/**
 * Format password strength as Vietnamese text
 */
export function getPasswordStrengthText(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'strong':
      return '✅ Mật khẩu mạnh';
    case 'medium':
      return '⚠️ Mật khẩu trung bình';
    case 'weak':
      return '❌ Mật khẩu yếu';
  }
}

/**
 * Get color class for password strength meter
 */
export function getPasswordStrengthColor(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'strong':
      return 'bg-green-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'weak':
      return 'bg-red-500';
  }
}

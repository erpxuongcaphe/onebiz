/**
 * Haptic feedback utilities for tablet/mobile.
 * Uses navigator.vibrate() — no-op on unsupported devices.
 */

/** Light tap — product selection, button press */
export function hapticTap(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(10);
  }
}

/** Success pattern — order sent, payment complete */
export function hapticSuccess(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([10, 50, 10]);
  }
}

/** Error pattern — failure, validation error */
export function hapticError(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([50, 30, 50, 30, 50]);
  }
}

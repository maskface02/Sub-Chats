export function allowOllamaUsers(): boolean {
  return process.env.ADMIN_ALLOW_OLLAMA_USERS === "true";
}

/**
 * Guest auto-session (local/direct-access mode). When true, unauthenticated
 * requests get a synthetic session bound to a shared guest user row — no
 * sign-up/sign-in required. All ownership checks still apply (everything the
 * guest creates belongs to the guest user).
 */
export function allowGuestAccess(): boolean {
  return process.env.ALLOW_GUEST_ACCESS === "true";
}

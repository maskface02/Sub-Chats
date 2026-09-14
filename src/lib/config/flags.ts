export function allowOllamaUsers(): boolean {
  return process.env.ADMIN_ALLOW_OLLAMA_USERS === "true";
}

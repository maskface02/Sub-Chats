// Public preset only. Credentials belong in encrypted per-user storage or a server-only env file.
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_MODEL = "meta/muse-glimmer-30b";
export const NVIDIA_GENERATION_SETTINGS = {
  temperature: 1,
  topP: 0.95,
  maxTokens: 8192,
} as const;

export function isNvidiaEndpoint(baseUrl: string | null | undefined): boolean {
  return baseUrl?.replace(/\/$/, "") === NVIDIA_BASE_URL;
}

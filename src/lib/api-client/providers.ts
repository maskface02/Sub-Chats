import { apiFetch } from "./base";
import type {
  ProviderCreateBody,
  ProviderDto,
  ProviderUpdateBody,
  ProvidersResponse,
} from "./types";

export async function listProviders(): Promise<ProvidersResponse> {
  return apiFetch<ProvidersResponse>(`/api/providers`);
}

export async function createProvider(body: ProviderCreateBody): Promise<ProviderDto> {
  return apiFetch<ProviderDto>(`/api/providers`, {
    method: "POST",
    body,
  });
}

export async function updateProvider(
  id: string,
  body: ProviderUpdateBody,
): Promise<ProviderDto> {
  return apiFetch<ProviderDto>(`/api/providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body,
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await apiFetch<null>(`/api/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

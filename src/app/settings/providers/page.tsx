import { ProviderList } from "@/components/settings/ProviderList";

export const dynamic = "force-dynamic";

export default function ProvidersSettingsPage() {
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">AI providers</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Add, edit, or remove AI providers. Your stored API keys are encrypted at
        rest and never shown again — only the last 4 characters are displayed.
      </p>
      <ProviderList />
    </div>
  );
}

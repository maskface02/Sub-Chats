import { ProviderList } from "@/components/settings/ProviderList";
import { ThemeSelector } from "@/components/settings/ThemeSelector";

export const dynamic = "force-dynamic";

export default function ProvidersSettingsPage() {
  return (
    <div>
      <ThemeSelector />
      <h2 className="mb-1 mt-8 text-lg font-semibold tracking-tight">AI providers</h2>
      <p className="mb-7 max-w-2xl text-sm leading-6 text-muted-foreground">
        Choose which model powers your conversations. API keys are encrypted at
        rest and only their final four characters remain visible.
      </p>
      <ProviderList />
    </div>
  );
}

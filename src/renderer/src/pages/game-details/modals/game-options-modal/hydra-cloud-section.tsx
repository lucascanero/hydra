import { useTranslation } from "react-i18next";

import type { LibraryGame } from "@types";
import { CloudSyncPanel } from "../../cloud-sync/cloud-sync-panel";

interface HydraCloudSettingsSectionProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  automaticWebDavSync: boolean;
  onToggleAutomaticCloudSync: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
  onToggleAutomaticWebDavSync: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
}

export function HydraCloudSettingsSection({
  game,
  automaticCloudSync,
  automaticWebDavSync,
  onToggleAutomaticCloudSync,
  onToggleAutomaticWebDavSync,
}: Readonly<HydraCloudSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  if (game.shop === "custom") {
    return (
      <p className="game-options-modal__category-note">
        {t("settings_not_available_for_custom_games")}
      </p>
    );
  }

  return (
    <div className="game-options-modal__cloud-panel">
      <CloudSyncPanel
        automaticCloudSync={automaticCloudSync}
        automaticWebDavSync={automaticWebDavSync}
        onToggleAutomaticCloudSync={onToggleAutomaticCloudSync}
        onToggleAutomaticWebDavSync={onToggleAutomaticWebDavSync}
      />
    </div>
  );
}

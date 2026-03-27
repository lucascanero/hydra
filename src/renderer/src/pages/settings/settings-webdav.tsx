import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import "./settings-webdav.scss";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";

const WEB_DAV_BACKUP_LIMIT_OPTIONS = [5, 10, 15, 20, 25] as const;

const isValidWebDavBackupLimit = (
  value: number
): value is (typeof WEB_DAV_BACKUP_LIMIT_OPTIONS)[number] => {
  return WEB_DAV_BACKUP_LIMIT_OPTIONS.includes(
    value as (typeof WEB_DAV_BACKUP_LIMIT_OPTIONS)[number]
  );
};

const normalizeWebDavBackupLimit = (value?: number | null) => {
  if (typeof value !== "number") {
    return "unlimited";
  }

  return isValidWebDavBackupLimit(value) ? String(value) : "unlimited";
};

const parseWebDavBackupLimit = (value: string): number | null => {
  if (value === "unlimited") {
    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || !isValidWebDavBackupLimit(parsedValue)) {
    return null;
  }

  return parsedValue;
};

export function SettingsWebDav() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [form, setForm] = useState({
    useWebDav: false,
    webDavHost: "",
    webDavUsername: "",
    webDavPassword: "",
    webDavLocation: "",
    webDavBackupsPerGameLimit: "unlimited",
  });

  const { showSuccessToast, showErrorToast } = useToast();
  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useWebDav: Boolean(userPreferences.webDavHost),
        webDavHost: userPreferences.webDavHost ?? "",
        webDavUsername: userPreferences.webDavUsername ?? "",
        webDavPassword: userPreferences.webDavPassword ?? "",
        webDavLocation: userPreferences.webDavLocation ?? "",
        webDavBackupsPerGameLimit: normalizeWebDavBackupLimit(
          userPreferences.webDavBackupsPerGameLimit
        ),
      });
    }
  }, [userPreferences]);

  const toggleWebDav = () => {
    const updatedValue = !form.useWebDav;

    setForm((prev) => ({ ...prev, useWebDav: updatedValue }));

    if (!updatedValue) {
      updateUserPreferences({
        webDavHost: null,
        webDavUsername: null,
        webDavPassword: null,
        webDavLocation: null,
      });
    }
  };

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      await updateUserPreferences({
        webDavHost: form.webDavHost || null,
        webDavUsername: form.webDavUsername || null,
        webDavPassword: form.webDavPassword || null,
        webDavLocation: form.webDavLocation || null,
        webDavBackupsPerGameLimit: parseWebDavBackupLimit(
          form.webDavBackupsPerGameLimit
        ),
      });

      showSuccessToast(t("changes_saved"));
    } catch {
      showErrorToast(t("webdav_save_failed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!form.webDavHost || !form.webDavUsername || !form.webDavPassword) {
      showErrorToast(t("webdav_missing_credentials"));
      return;
    }

    setIsTesting(true);

    try {
      await window.electron.testWebDavConnection(
        form.webDavHost,
        form.webDavUsername,
        form.webDavPassword
      );
      showSuccessToast(t("webdav_connection_success"));
    } catch {
      showErrorToast(t("webdav_connection_failed"));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <form className="settings-webdav__form" onSubmit={handleFormSubmit}>
      <p className="settings-webdav__description">{t("webdav_description")}</p>

      <CheckboxField
        label={t("enable_webdav")}
        checked={form.useWebDav}
        onChange={toggleWebDav}
      />

      {form.useWebDav && (
        <>
          <TextField
            label={t("webdav_host")}
            value={form.webDavHost}
            placeholder="https://example.com/webdav"
            onChange={(event) =>
              setForm({ ...form, webDavHost: event.target.value })
            }
          />

          <TextField
            label={t("webdav_username")}
            value={form.webDavUsername}
            onChange={(event) =>
              setForm({ ...form, webDavUsername: event.target.value })
            }
            placeholder={t("webdav_username")}
          />

          <TextField
            label={t("webdav_password")}
            value={form.webDavPassword}
            type="password"
            onChange={(event) =>
              setForm({ ...form, webDavPassword: event.target.value })
            }
            placeholder={t("webdav_password")}
          />

          <TextField
            label={t("webdav_location")}
            value={form.webDavLocation}
            placeholder="/hydra-backups"
            onChange={(event) =>
              setForm({ ...form, webDavLocation: event.target.value })
            }
            hint={t("webdav_location_hint")}
          />

          <SelectField
            label={t("webdav_backups_per_game_limit")}
            value={form.webDavBackupsPerGameLimit}
            options={[
              ...WEB_DAV_BACKUP_LIMIT_OPTIONS.map((limit) => ({
                key: String(limit),
                value: String(limit),
                label: String(limit),
              })),
              {
                key: "unlimited",
                value: "unlimited",
                label: t("webdav_backups_per_game_limit_unlimited"),
              },
            ]}
            onChange={(event) =>
              setForm({
                ...form,
                webDavBackupsPerGameLimit: event.target.value,
              })
            }
          />

          <div className="settings-webdav__actions">
            <Button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isLoading}
              theme="outline"
            >
              {isTesting ? t("webdav_testing") : t("webdav_test_connection")}
            </Button>

            <Button type="submit" disabled={isLoading}>
              {t("save_changes")}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

function setupUpdates({ updater, dialog, setStatus, packaged, installUpdate = () => updater.quitAndInstall() }) {
  let checking = false, checkingManually = false, deferredVersion, prompting = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;

  updater.on("update-available", async info => {
    setStatus("Update available: " + info.version);
    if (prompting || (deferredVersion === info.version && !checkingManually)) return;
    prompting = true;
    const choice = await dialog.showMessageBox({
      type: "info",
      title: "Sprig update available",
      message: "Sprig " + info.version + " is available.",
      detail: "Download the update now? Your current work will not be closed.",
      buttons: ["Download update", "Later"],
      defaultId: 0,
      cancelId: 1
    });
    prompting = false;
    if (choice.response !== 0) { deferredVersion = info.version; return; }
    deferredVersion = undefined;
    try {
      setStatus("Downloading update");
      await updater.downloadUpdate();
    } catch (error) {
      setStatus("Update download failed");
      await dialog.showMessageBox({ type: "error", title: "Sprig update failed",
        message: "Could not download the update.", detail: error.message });
    }
  });
  updater.on("update-downloaded", async info => {
    setStatus("Update ready: " + info.version);
    const choice = await dialog.showMessageBox({
      type: "info",
      title: "Sprig update ready",
      message: "Sprig " + info.version + " is ready to install.",
      detail: "Save your work and stop running programs before restarting Sprig to install the update.",
      buttons: ["Restart and install", "Later"],
      defaultId: 1,
      cancelId: 1
    });
    if (choice.response === 0) installUpdate();
    else deferredVersion = info.version;
  });
  updater.on("error", error => {
    setStatus("Update check or download failed");
    console.error("Sprig updater:", error);
  });

  return async function checkForUpdates(manual = false) {
    if (process.env.SPRIG_DISABLE_UPDATES === "1") return;
    if (!packaged) {
      if (manual) await dialog.showMessageBox({ type: "info", title: "Sprig updates",
        message: "Update checks are available in the installed app." });
      return;
    }
    if (checking) return;
    checking = true;
    checkingManually = manual;
    setStatus("Checking for updates");
    try {
      const result = await updater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) {
        setStatus("Sprig is up to date");
        if (manual) await dialog.showMessageBox({ type: "info", title: "Sprig updates",
          message: "Sprig is up to date." });
      }
    } catch (error) {
      setStatus("Update check failed");
      console.error("Could not check for Sprig updates:", error);
      if (manual) await dialog.showMessageBox({ type: "error", title: "Sprig update check failed",
        message: "Could not check for updates.", detail: error.message });
    } finally {
      checking = false;
      checkingManually = false;
    }
  };
}

module.exports = { setupUpdates };

const link = document.getElementById("downloadLink");
const status = document.getElementById("downloadStatus");

fetch("https://api.github.com/repos/The-Lab-to-Code/sprig-online-compiler/releases/latest")
  .then(response => {
    if (!response.ok) throw new Error("Release information is unavailable.");
    return response.json();
  })
  .then(release => {
    const asset = release.assets.find(item => /^Sprig-Setup-\d+\.\d+\.\d+\.exe$/.test(item.name));
    if (!asset || !asset.browser_download_url.startsWith("https://github.com/The-Lab-to-Code/sprig-online-compiler/releases/download/")) {
      throw new Error("No Windows installer found in the latest release.");
    }
    link.href = asset.browser_download_url;
    status.textContent = `Windows 64-bit · ${release.tag_name} · Official GitHub release`;
  })
  .catch(error => {
    status.textContent = "Windows 64-bit · Open the latest release to download the installer.";
    console.error("Could not load the latest Sprig installer:", error);
  });

const fs = require("fs");
const path = require("path");

function createPreferences(directory) {
  const file = path.join(directory, "preferences.json");
  let state = { startup: "home", theme: null };
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!saved || !["home", "editor"].includes(saved.startup) ||
        (saved.theme !== null && saved.theme !== "light" && saved.theme !== "dark")) {
      throw new Error("Invalid desktop preferences in " + file);
    }
    state = saved;
  }
  return {
    get: () => ({ ...state }),
    update(changes) {
      if (!changes || typeof changes !== "object" || Array.isArray(changes) ||
          Object.keys(changes).some(key => !["startup", "theme"].includes(key))) {
        throw new Error("Invalid desktop preference.");
      }
      const next = { ...state, ...changes };
      if (!["home", "editor"].includes(next.startup) ||
          (next.theme !== null && next.theme !== "light" && next.theme !== "dark")) {
        throw new Error("Invalid desktop preference value.");
      }
      const temporary = file + ".tmp";
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", "utf8");
      fs.renameSync(temporary, file);
      state = next;
      return { ...state };
    }
  };
}

module.exports = { createPreferences };

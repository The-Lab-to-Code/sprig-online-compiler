import { writeFile } from "node:fs/promises";
import { listRuntimes as listWandbox } from "../functions/_lib/wandbox.mjs";
import { listRuntimes as listTio } from "../functions/_lib/tio.mjs";

const [wandbox, tio] = await Promise.all([listWandbox(), listTio()]);
if (wandbox.length < 20 || tio.length < 100) throw new Error("The language catalogs are unexpectedly small.");

const snapshot = Object.fromEntries([["wandbox", wandbox], ["tio", tio]].map(([provider, runtimes]) => [
  provider,
  runtimes.map(runtime => ({
    provider, baseLanguage: runtime.baseLanguage, displayName: runtime.displayName,
    ext: runtime.ext, ...(provider === "tio" ? { tioKey: runtime.tioKey } : {}),
    ...(runtime.starter ? { starter: runtime.starter } : {}),
    versions: []
  }))
]));
await writeFile(new URL("../sprig-vendor/language-catalog.json", import.meta.url), JSON.stringify(snapshot) + "\n");
console.log(`Saved ${wandbox.length} Wandbox and ${tio.length} TIO language families.`);

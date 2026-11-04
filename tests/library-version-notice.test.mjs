import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dictionaries = {};
for (const language of ["ko", "en"]) dictionaries[language] = JSON.parse(await readFile(new URL(`../lang/${language}.json`, import.meta.url), "utf8"));
let importId = 0;
const freshNotice = () => import(`../scripts/ui/library-version-notice.js?test=${++importId}`);
const required = minimum => ({ id: "glitchsmith-lib", type: "module", compatibility: { minimum } });
const dependent = (id, minimum, extras = {}) => ({ id, title: id, active: false,
  relationships: { requires: [required(minimum)] }, ...extras });

function setup(t, { version = "0.13.1", modules = [], gm = true, language = "ko" } = {}) {
  const previous = new Map(["game", "foundry", "ui"].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of previous) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  const dialogs = [], warnings = [], comparisons = [];
  const localize = key => key.split(".").reduce((value, part) => value?.[part], dictionaries[language]) ?? key;
  globalThis.game = {
    modules: new Map([{ id: "glitchsmith-lib", version, active: true }, ...modules].map(mod => [mod.id, mod])),
    user: { isGM: gm },
    i18n: { localize, format: (key, params) => localize(key).replace(/\{(\w+)\}/g, (_match, name) => params[name]) },
    settings: { get() { throw Error("Version guidance must not depend on release-notification settings"); } },
  };
  globalThis.foundry = {
    utils: { isNewerVersion: (candidate, current) => {
      comparisons.push([candidate, current]);
      const a = candidate.split(".").map(Number), b = current.split(".").map(Number);
      for (let index = 0; index < Math.max(a.length, b.length); index++) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
      }
      return false;
    } },
    applications: { api: { DialogV2: { wait: async options => { dialogs.push(options); return "acknowledge"; } } } },
  };
  globalThis.ui = { notifications: { warn: (...args) => warnings.push(args) } };
  return { dialogs, warnings, comparisons };
}

test("inactive dependents are included and the highest required version is reported", async t => {
  setup(t, { version: "0.9.0", modules: [dependent("VNM", "0.13.1"), dependent("Shop", "0.14.0"), dependent("Older", "0.8.0")] });
  const { collectLibraryVersionIssues } = await freshNotice();
  assert.deepEqual(collectLibraryVersionIssues(), { installedVersion: "0.9.0", requiredVersion: "0.14.0",
    modules: [{ id: "Shop", title: "Shop", minimum: "0.14.0" }, { id: "VNM", title: "VNM", minimum: "0.13.1" }] });
});

test("equal and newer installed library versions need no notice", async t => {
  const { dialogs } = setup(t, { modules: [dependent("VNM", "0.13.1"), dependent("Shop", "0.12.0")] });
  const { collectLibraryVersionIssues, showLibraryVersionNotice } = await freshNotice();
  assert.equal(collectLibraryVersionIssues(), null);
  assert.equal(await showLibraryVersionNotice(), false);
  assert.equal(dialogs.length, 0);
  game.modules.get("glitchsmith-lib").version = "0.20.0";
  assert.equal(collectLibraryVersionIssues(), null);
});

test("optional, recommended, and unrelated dependencies do not request a library update", async t => {
  setup(t, { modules: [{ id: "optional", relationships: { optional: [required("9.0.0")], recommends: [required("9.0.0")],
    requires: [{ id: "something-else", type: "module", compatibility: { minimum: "9.0.0" } }] } },
    dependent("unbounded", undefined), { id: "unrelated" }] });
  const { collectLibraryVersionIssues } = await freshNotice();
  assert.equal(collectLibraryVersionIssues(), null);
});

test("Foundry Set relationships and module title characters are retained", async t => {
  const { dialogs } = setup(t, { modules: [dependent("a", "0.14.0", { title: "A & B <test>", relationships: { requires: new Set([required("0.14.0")]) } })] });
  const { showLibraryVersionNotice } = await freshNotice();
  await showLibraryVersionNotice();
  assert.match(dialogs[0].content, /A &amp; B &lt;test&gt;/);
});

test("players receive no compatibility dialog or notification", async t => {
  const { dialogs, warnings } = setup(t, { gm: false, modules: [dependent("VNM", "0.14.0")] });
  const { showLibraryVersionNotice } = await freshNotice();
  assert.equal(await showLibraryVersionNotice(), false);
  assert.equal(dialogs.length, 0);
  assert.equal(warnings.length, 0);
});

for (const language of ["ko", "en"]) {
  test(`${language}: one dialog lists all mismatches, update steps, and installed version`, async t => {
    const { dialogs } = setup(t, { language, modules: [dependent("VNM", "0.13.2"), dependent("Shop", "0.14.0")] });
    const { showLibraryVersionNotice } = await freshNotice();
    await showLibraryVersionNotice();
    assert.equal(dialogs.length, 1);
    for (const expected of ["VNM", "Shop", "0.13.1", "0.13.2", "0.14.0"]) assert.ok(dialogs[0].content.includes(expected));
    assert.match(dialogs[0].content, language === "ko" ? /모듈 관리/ : /Manage Modules/);
    assert.equal(dialogs[0].buttons.length, 1);
    assert.equal(dialogs[0].buttons[0].callback, undefined, "acknowledgment does not change modules or leave the world");
    assert.equal(dialogs[0].rejectClose, false);
  });
}

test("concurrent and repeated checks show once per page load, including after dismissal", async t => {
  setup(t, { modules: [dependent("VNM", "0.14.0")] });
  let resolve, count = 0;
  foundry.applications.api.DialogV2.wait = () => { count++; return new Promise(done => { resolve = done; }); };
  const { showLibraryVersionNotice } = await freshNotice();
  const pending = showLibraryVersionNotice();
  assert.equal(await showLibraryVersionNotice(), false);
  assert.equal(count, 1);
  resolve(); await pending;
  assert.equal(await showLibraryVersionNotice(), false);
  assert.equal(count, 1);
});

test("a dialog-render failure falls back to one readable persistent notification", async t => {
  const { warnings } = setup(t, { modules: [dependent("VNM", "0.14.0")] });
  const oldError = console.error; console.error = () => {}; t.after(() => { console.error = oldError; });
  foundry.applications.api.DialogV2.wait = async () => { throw Error("render failed"); };
  const { showLibraryVersionNotice } = await freshNotice();
  assert.equal(await showLibraryVersionNotice(), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /0\.13\.1/); assert.match(warnings[0][0], /0\.14\.0/);
  assert.equal(warnings[0][1].permanent, true);
  assert.equal(await showLibraryVersionNotice(), false);
});

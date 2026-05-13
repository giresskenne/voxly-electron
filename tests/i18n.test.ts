import test from "node:test";
import assert from "node:assert/strict";
import { htmlLang, translate } from "../src/renderer/lib/i18n";

test("French France display language translates core UI labels", () => {
  assert.equal(translate("fr-FR", "settings.displayLanguage"), "Langue de l'interface");
  assert.equal(translate("fr-FR", "nav.home"), "Accueil");
  assert.equal(translate("fr-FR", "overlay.listening"), "Écoute");
});

test("display language maps to html lang", () => {
  assert.equal(htmlLang("fr-FR"), "fr-FR");
  assert.equal(htmlLang("en"), "en");
});

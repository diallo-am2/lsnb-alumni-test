// Pure helpers of the web app (../../src/lib, ../../src/data). They have no browser or
// Supabase dependency, so the API's test runner can cover them too.
import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES, findCountry, normalizeKey } from "../../src/data/countries.ts";
import { formatFileSize } from "../../src/lib/fileSize.ts";
import { fitWithin } from "../../src/lib/imageResize.ts";
import { formatPhone, isValidEmail, normalizePhone, validateShare, whatsappLink } from "../../src/lib/requestValidation.ts";
import { applyFormat, type FormatAction } from "../../src/lib/richTextEditing.ts";
import { describeUploadError } from "../../src/lib/uploadErrors.ts";

const fmt = (action: FormatAction, value: string, start = 0, end = value.length) => {
  const result = applyFormat(action, value, start, end, 8000);
  assert.ok(result, "a result");
  return result;
};

test("request validation: phone numbers", () => {
  assert.equal(normalizePhone("+226 70 12 34 56"), "+22670123456");
  assert.equal(normalizePhone("00226 70-12-34-56"), "+22670123456");
  assert.equal(normalizePhone("+33 (0)6 12 34 56 78"), "+33612345678");
  assert.equal(normalizePhone("0612345678"), null);
  assert.equal(normalizePhone("+1234"), null);
  assert.equal(whatsappLink("+22670123456"), "https://wa.me/22670123456");
  assert.equal(formatPhone("+22670123456"), "+226 70 12 34 56");
});

test("request validation: what is shared when accepting", () => {
  assert.equal(validateShare({ shareEmail: false, email: "", sharePhone: false, phone: "" }).ok, false);
  assert.deepEqual(validateShare({ shareEmail: true, email: " a@b.co ", sharePhone: false, phone: "junk" }), { ok: true, email: "a@b.co" });
  assert.deepEqual(validateShare({ shareEmail: false, email: "bad", sharePhone: true, phone: "+226 70 12 34 56" }), { ok: true, phone: "+22670123456" });
  assert.equal(validateShare({ shareEmail: true, email: "bad", sharePhone: false, phone: "" }).ok, false);
  assert.equal(isValidEmail("a b@c.d"), false);
});

test("images are shrunk to fit, never enlarged", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(100000, 10, 1600), { width: 1600, height: 1 });
});

test("file sizes and upload errors read well in French", () => {
  assert.equal(formatFileSize(1_250_000), "1,2 Mo");
  assert.equal(formatFileSize(10), "1 Ko");
  assert.match(describeUploadError({ statusCode: "413", message: "The object exceeded the maximum allowed size" }), /trop volumineux/);
  assert.match(describeUploadError(new TypeError("Failed to fetch")), /interrompu/);
  assert.match(describeUploadError({ message: "new row violates row-level security policy" }), /session/);
  assert.equal(describeUploadError({ code: "P0001", message: "Un seul document PDF par offre." }), "Un seul document PDF par offre.");
  assert.match(describeUploadError({ message: "???" }), /a échoué/);
});

test("countries: every name is unique once normalised, and spellings converge", () => {
  const keys = COUNTRIES.map(normalizeKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const [input, expected] of [
    ["maroc", "Maroc"], ["  MAROC ", "Maroc"], ["Morocco", "Maroc"], ["cote d'ivoire", "Côte d’Ivoire"],
    ["Côte d’Ivoire", "Côte d’Ivoire"], ["Ivory Coast", "Côte d’Ivoire"], ["burkina", "Burkina Faso"],
    ["burkina-faso", "Burkina Faso"], ["USA", "États-Unis"], ["etats-unis", "États-Unis"], ["UK", "Royaume-Uni"],
    ["RDC", "République démocratique du Congo"], ["senegal", "Sénégal"], ["Congo", "Congo"],
  ] as const) {
    assert.equal(findCountry(input), expected, input);
  }
  assert.equal(findCountry(""), null);
  assert.equal(findCountry("Atlantide"), null);
  assert.equal(findCountry("Mar"), null);
});

test("toolbar: bold and italic wrap, toggle off, and do not confuse each other", () => {
  assert.deepEqual(fmt("bold", "une bourse", 4, 10), { value: "une **bourse**", selectionStart: 6, selectionEnd: 12 });
  assert.equal(fmt("bold", "une **bourse**", 6, 12).value, "une bourse");
  assert.equal(fmt("bold", "**bourse**").value, "bourse");
  assert.equal(fmt("bold", "", 0, 0).value, "**texte en gras**");
  assert.equal(fmt("italic", "une bourse", 4, 10).value, "une *bourse*");
  assert.equal(fmt("italic", "une *bourse*", 5, 11).value, "une bourse");
  // Selecting the text inside **bold** and pressing italic must add italics, not strip a bold asterisk.
  assert.equal(fmt("italic", "une **bourse**", 6, 12).value, "une ***bourse***");
});

test("toolbar: headings and lists work on whole lines and toggle", () => {
  assert.equal(fmt("heading", "Conditions", 3, 3).value, "## Conditions");
  assert.equal(fmt("heading", "## Conditions", 5, 5).value, "Conditions");
  assert.equal(fmt("bullets", "a\nb\nc", 0, 3).value, "- a\n- b\nc");
  assert.equal(fmt("bullets", "- a\n- b").value, "a\nb");
  assert.equal(fmt("numbers", "a\n\nb").value, "1. a\n\n2. b");
  assert.equal(fmt("numbers", "1. a\n2. b").value, "a\nb");
  assert.equal(fmt("bullets", "1. a\n2. b").value, "- a\n- b");
  assert.equal(fmt("heading", "- a").value, "## a");
  // Selection that ends right after a line break must not drag the next line along.
  assert.equal(fmt("bullets", "a\nb", 0, 2).value, "- a\nb");
  // An empty line gets the marker so the member can start typing.
  assert.deepEqual(fmt("bullets", "", 0, 0), { value: "- ", selectionStart: 2, selectionEnd: 2 });
});

test("toolbar: links keep the https:// rule visible and the result stays within the limit", () => {
  assert.deepEqual(fmt("link", "", 0, 0), { value: "[texte du lien](https://)", selectionStart: 1, selectionEnd: 14 });
  const withText = fmt("link", "voir ici", 5, 8);
  assert.equal(withText.value, "voir [ici](https://)");
  assert.equal(withText.value.slice(withText.selectionStart, withText.selectionEnd), "https://");
  assert.equal(fmt("link", "https://fondation.org/x").value, "[lien](https://fondation.org/x)");
  assert.equal(applyFormat("bold", "x".repeat(10), 0, 10, 12), null);
});

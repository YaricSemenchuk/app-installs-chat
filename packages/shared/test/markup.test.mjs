// Разметка сообщений: разбор, экранирование, упоминания. Запуск: npm test -w @teamchat/shared (после сборки).
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLineStart, escapeText, extractMentions, linkMarkup, markupToPlainText, parseInline, parseMarkup } from "../dist/index.js";

const U = "6863f4b9-5c97-433a-9ed7-50a21895984d";
const C = "e691b097-05b6-4ed8-8c66-e04da8c7f1a7";
const t = (v) => ({ t: "text", v });

test("inline marks, nesting and code", () => {
  assert.deepEqual(parseInline("*жирный* и _курсив_ и ~нет~"), [
    { t: "bold", c: [t("жирный")] },
    t(" и "),
    { t: "italic", c: [t("курсив")] },
    t(" и "),
    { t: "strike", c: [t("нет")] },
  ]);
  assert.deepEqual(parseInline("*_оба_*"), [{ t: "bold", c: [{ t: "italic", c: [t("оба")] }] }]);
  assert.deepEqual(parseInline("`a *b* c`"), [{ t: "code", v: "a *b* c" }]);
  assert.deepEqual(parseInline("**двойные**"), [{ t: "bold", c: [{ t: "bold", c: [t("двойные")] }] }]);
});

test("markers inside words and unmatched markers stay text", () => {
  assert.deepEqual(parseInline("snake_case_name"), [t("snake_case_name")]);
  assert.deepEqual(parseInline("2*3*4"), [t("2*3*4")]);
  assert.deepEqual(parseInline("* не список"), [t("* не список")]);
  assert.deepEqual(parseInline("_a *b_ *c*"), [{ t: "italic", c: [t("a *b")] }, t(" "), { t: "bold", c: [t("c")] }]);
  assert.deepEqual(parseInline("цена *50 руб"), [t("цена *50 руб")]);
});

test("escapes round-trip through the parser", () => {
  const raw = "2*3 = *шесть* <@x> `код` ~ _ \\";
  assert.deepEqual(parseInline(escapeText(raw)), [t(raw)]);
  assert.equal(escapeLineStart("- не список"), "\\- не список");
  assert.equal(escapeLineStart("1. не список"), "1\\. не список");
  assert.equal(escapeLineStart("> не цитата"), "\\> не цитата");
  assert.deepEqual(parseMarkup(escapeLineStart("- не список")), [{ t: "p", c: [t("- не список")] }]);
});

test("tokens and links", () => {
  assert.deepEqual(parseInline(`привет <@${U}> и <!here> в <#${C}>`), [
    t("привет "),
    { t: "user", id: U },
    t(" и "),
    { t: "broadcast", v: "here" },
    t(" в "),
    { t: "channel", id: C },
  ]);
  assert.deepEqual(parseInline("<https://example.com/a?b=1|*сайт*>"), [
    { t: "link", url: "https://example.com/a?b=1", c: [{ t: "bold", c: [t("сайт")] }] },
  ]);
  assert.deepEqual(parseInline("см. https://example.com/x."), [
    t("см. "),
    { t: "link", url: "https://example.com/x", c: [t("https://example.com/x")] },
    t("."),
  ]);
  assert.deepEqual(parseInline("<javascript:alert(1)|x>"), [t("<javascript:alert(1)|x>")]);
  assert.equal(linkMarkup("https://a.b/c", escapeText("https://a.b/c")), "<https://a.b/c>");
  assert.equal(linkMarkup("https://a.b/c d", "подпись"), "<https://a.b/c%20d|подпись>");
});

test("blocks: code, quote, nested lists, paragraphs", () => {
  const src = ["первая", "```", "const a = 1;", "  *не жирный*", "```", "> цитата", "> *вторая*", "- раз", "  1. вложенный", "- два", "", "3. три"].join("\n");
  assert.deepEqual(parseMarkup(src), [
    { t: "p", c: [t("первая")] },
    { t: "pre", v: "const a = 1;\n  *не жирный*" },
    { t: "quote", lines: [[t("цитата")], [{ t: "bold", c: [t("вторая")] }]] },
    {
      t: "ul",
      start: 1,
      items: [{ c: [t("раз")], sub: { t: "ol", start: 1, items: [{ c: [t("вложенный")] }] } }, { c: [t("два")] }],
    },
    { t: "p", c: [] },
    { t: "ol", start: 3, items: [{ c: [t("три")] }] },
  ]);
  assert.deepEqual(parseMarkup("```print(1)```"), [{ t: "pre", v: "print(1)" }]);
});

test("mentions skip code and escaped tokens", () => {
  const text = `<@${U}> \`<!channel>\` \\<!here> > \n> <!here>`;
  assert.deepEqual(extractMentions(text), { userIds: [U], broadcast: ["here"] });
  assert.deepEqual(extractMentions("```\n<!channel>\n```"), { userIds: [], broadcast: [] });
});

test("plain text for previews", () => {
  const names = { user: () => "Марк", channel: () => "general" };
  assert.equal(markupToPlainText(`*Итог:* <@${U}> в <#${C}>\n- раз\n- два`, names), "Итог: @Марк в #general\n• раз\n• два");
});

test("a huge run of markers parses quickly", () => {
  const started = Date.now();
  parseInline("*a ".repeat(20_000));
  parseInline("_x *".repeat(10_000) + "y*");
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});

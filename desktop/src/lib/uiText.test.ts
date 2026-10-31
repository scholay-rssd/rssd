import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import i18n from "i18next";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import en from "../locales/ui.en.json";
import ja from "../locales/ui.ja.json";
import { tr, trNative, uiLocale } from "../uiText";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const HAN = /[㐀-鿿]/;
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "locales" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** Chinese source strings reachable from tr()/trKey() arguments, including
 *  ternary branches, ?? / || fallbacks and inline lookup objects. */
function sourceKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const path of sourceFiles(SRC)) {
    if (!/\btr(Key)?\(/.test(readFileSync(path, "utf8"))) continue;
    const collect = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (HAN.test(node.text) && !keys.has(node.text)) keys.set(node.text, path);
      } else if (ts.isConditionalExpression(node)) {
        collect(node.whenTrue); collect(node.whenFalse);
      } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
        collect(node.expression);
      } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        collect(node.left); collect(node.right);
      } else if (ts.isElementAccessExpression(node)) {
        collect(node.expression);
      } else if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) if (ts.isPropertyAssignment(property)) collect(property.initializer);
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["tr", "trKey"].includes(node.expression.text) && node.arguments[0]) collect(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(parse(path));
  }
  return keys;
}

describe("source-text interface translations", () => {
  afterEach(() => { (i18n as { language?: string }).language = undefined; });
  const tables: [string, Record<string, string>][] = [["en", en], ["ja", ja]];

  it("translates every tr() and trKey() source string into English and Japanese", () => {
    const missing: string[] = [];
    for (const [key, path] of sourceKeys()) {
      for (const [lang, table] of tables) if (!table[key]) missing.push(`${lang}: ${JSON.stringify(key)} (${path.slice(SRC.length)})`);
    }
    expect(missing).toEqual([]);
  });

  it("keeps placeholders identical to the Chinese source", () => {
    for (const [lang, table] of tables) {
      for (const [key, value] of Object.entries(table)) {
        expect(placeholders(value.replace(/_one$/, "")), `${lang}: ${key}`).toEqual(placeholders(key.replace(/_one$/, "")));
      }
    }
  });

  it("leaves no untranslated Chinese text nodes in screens", () => {
    const raw: string[] = [];
    for (const path of sourceFiles(SRC).filter((file) => file.endsWith(".tsx"))) {
      const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node) && HAN.test(node.text)) raw.push(`${path.slice(SRC.length)}: ${node.text.trim()}`);
        ts.forEachChild(node, visit);
      };
      visit(parse(path));
    }
    expect(raw).toEqual([]);
  });

  it("returns source text for Chinese and fills placeholders in every language", () => {
    (i18n as { language?: string }).language = "zh";
    expect(tr("已保存 {{count}} 篇", { count: 3 })).toBe("已保存 {{count}} 篇".replace("{{count}}", "3"));
    expect(trNative("无法读取稿件目录：权限不足")).toBe("无法读取稿件目录：权限不足");
    expect(uiLocale()).toBe("zh-CN");
    (i18n as { language?: string }).language = "en";
    expect(tr("推送完成")).toBe("Push complete");
    expect(tr("已完成 {{count}} 步", { count: 2 })).toBe("2 steps done");
    expect(tr("没有对应翻译的原文")).toBe("没有对应翻译的原文");
    expect(uiLocale()).toBe("en-US");
    expect(trNative("无法读取文章")).toBe("Couldn't read the article");
    expect(trNative("无法读取稿件目录：权限不足")).toBe("Couldn't read the draft folder: 权限不足");
    expect(trNative("未知的后端信息")).toBe("未知的后端信息");
    (i18n as { language?: string }).language = "ja";
    expect(tr("推送完成")).toBe("プッシュ完了");
    expect(uiLocale()).toBe("ja-JP");
  });
});

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";

/**
 * Languages whose fenced code blocks are syntax highlighted.
 *
 * Deliberately a curated set rather than `@codemirror/language-data`. That manifest reaches
 * every language CodeMirror supports through dynamic imports, which esbuild resolves at build
 * time — so "lazy" would have meant bundling all of them into the webview. These are the ones
 * that actually turn up in engineering notes; anything else still renders as plain monospace,
 * which is what every fence did before.
 */
export const codeLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "javascript",
    alias: ["js", "jsx", "mjs", "cjs", "node"],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "typescript",
    alias: ["ts", "tsx"],
    support: javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({ name: "json", alias: ["jsonc"], support: json() }),
  LanguageDescription.of({ name: "python", alias: ["py"], support: python() }),
  LanguageDescription.of({ name: "yaml", alias: ["yml"], support: yaml() }),
  LanguageDescription.of({ name: "html", alias: ["htm"], support: html() }),
  LanguageDescription.of({ name: "css", support: css() }),
  LanguageDescription.of({
    name: "shell",
    alias: ["sh", "bash", "zsh", "console", "shell-session"],
    // A legacy stream mode needs wrapping before it satisfies LanguageSupport.
    support: new LanguageSupport(StreamLanguage.define(shell)),
  }),
];

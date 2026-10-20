import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const rendererRoot = path.join(projectRoot, "src", "renderer");

function filesUnder(directory, extensions) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(file, extensions);
    return extensions.has(path.extname(entry.name)) ? [file] : [];
  });
}

function distinctMatches(text, expression) {
  return [...new Set([...text.matchAll(expression)].map((match) => (match[1] ?? match[0]).trim()))].sort();
}

function declarationValues(text, property) {
  return distinctMatches(text, new RegExp(`${property}\\s*:\\s*([^;\\n}]+)`, "gi"));
}

function lineAt(text, position) {
  return text.slice(0, position).split(/\r?\n/).length;
}

function jsxOpeningTagEnd(text, start) {
  let braces = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces = Math.max(0, braces - 1);
    } else if (character === ">" && braces === 0) {
      return index;
    }
  }
  return -1;
}

function jsxAudit(files) {
  const buttonsWithoutClassName = [];
  const inlineStyles = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const relativeFile = path.relative(projectRoot, file).replaceAll("\\", "/");
    const buttonPattern = /<button\b/g;
    for (const match of text.matchAll(buttonPattern)) {
      const end = jsxOpeningTagEnd(text, match.index);
      if (end === -1) continue;
      const openingTag = text.slice(match.index, end + 1);
      if (!/\bclassName\s*=/.test(openingTag)) {
        buttonsWithoutClassName.push({ file: relativeFile, line: lineAt(text, match.index) });
      }
    }
    for (const match of text.matchAll(/\bstyle\s*=/g)) {
      inlineStyles.push({ file: relativeFile, line: lineAt(text, match.index) });
    }
  }

  return { buttonsWithoutClassName, inlineStyles };
}

const cssFiles = filesUnder(rendererRoot, new Set([".css"]));
const css = cssFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const sourceFiles = filesUnder(rendererRoot, new Set([".tsx"]));
const jsx = jsxAudit(sourceFiles);

const fixedHeightDeclarations = [
  ...css.matchAll(/(?<![-\w])height\s*:\s*\d+(?:\.\d+)?px\b/gi),
].length;
const fixedMinHeightDeclarations = [
  ...css.matchAll(/min-height\s*:\s*\d+(?:\.\d+)?px\b/gi),
].length;
const maxHeightDeclarations = [
  ...css.matchAll(/max-height\s*:\s*[^;\n}]+/gi),
].length;

const report = {
  cssFiles: cssFiles.length,
  cssLines: css.split(/\r?\n/).length,
  distinctHexColors: distinctMatches(css, /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/gi).length,
  distinctRgbaColors: distinctMatches(css, /rgba?\([^)]*\)/gi).length,
  distinctFontSizes: declarationValues(css, "font-size"),
  distinctBorderRadii: declarationValues(css, "border-radius"),
  fixedHeightDeclarations,
  fixedMinHeightDeclarations,
  maxHeightDeclarations,
  importantDeclarations: (css.match(/!important\b/gi) ?? []).length,
  buttonsWithoutClassName: jsx.buttonsWithoutClassName,
  inlineStyles: jsx.inlineStyles,
};

console.log("FC Arena — auditoria de CSS");
console.log(JSON.stringify(report, null, 2));

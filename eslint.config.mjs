import babelParser from "@babel/eslint-parser";

export default [
  {
    ignores: ["dist/", "dist-electron/", "node_modules/"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [["@babel/preset-typescript", { allExtensions: true, isTSX: true }]],
        },
      },
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-dupe-else-if": "error",
      "no-unsafe-finally": "error",
    },
  },
];

// pandoc-wasm 1.1.0 ships no type declarations.
declare module "pandoc-wasm" {
  export const convert: import("./convert.ts").PandocConvert;
}

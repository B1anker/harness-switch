/**
 * Stands in for `shiki/wasm`, the 608KB inlined Oniguruma binary.
 *
 * `@pierre/diffs` picks its regex engine from `preferredHighlighter`, which defaults to
 * `'shiki-js'`; only `'shiki-wasm'` reaches for this module. Nothing in this app passes
 * that option, and the JS engine tokenizes all three grammars we ship (JSON, TOML, YAML)
 * with no warnings — the WASM engine exists for grammars using patterns the JS engine
 * cannot translate, and none of ours do.
 *
 * `rspack.config.ts` aliases the module here so the binary stays out of the bundle. It
 * throws rather than returning something empty: if a future change does opt into the WASM
 * engine, the failure should name its own cause instead of surfacing as a corrupt-module
 * error from deep inside Shiki.
 */
function unavailable(): never {
  throw new Error(
    "shiki's WASM engine is stubbed out in this build (see apps/web/src/shiki/wasm-stub.ts). " +
      'Either keep preferredHighlighter at its "shiki-js" default, or drop the ' +
      'rspack alias for shiki/wasm to ship the real binary.',
  );
}

export default unavailable;
export const getWasmInstance = unavailable;
export const wasmBinary = new Uint8Array(0);

// Bumped whenever the slide model shape changes so cached models
// (pptxStore 'models') from an older parser are re-parsed, not reused.
// Its own module so pptxModel.js can check the cache without loading the
// parser (pptxHandler.js re-exports it).
export const PARSER_VERSION = 2;

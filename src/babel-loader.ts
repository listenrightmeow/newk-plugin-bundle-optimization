// Lazy loader for Babel to prevent conflicts
let babelParser: any;
let babelTraverse: any;
let babelTypes: any;

export async function loadBabel() {
  if (!babelParser) {
    // Dynamic imports to isolate Babel loading
    const [parser, traverse, types] = await Promise.all([
      import('@babel/parser'),
      import('@babel/traverse'),
      import('@babel/types')
    ]);
    
    babelParser = parser;
    babelTraverse = traverse.default || traverse;
    babelTypes = types;
  }
  
  return {
    parse: babelParser.parse,
    traverse: babelTraverse,
    t: babelTypes
  };
}
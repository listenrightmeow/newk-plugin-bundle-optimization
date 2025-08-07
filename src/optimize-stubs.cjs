const fs = require('fs');
const path = require('path');
const glob = require('fast-glob');

async function optimizeStubs(projectPath) {
  const componentFiles = await glob('client/src/components/**/*.{tsx,ts}', {
    cwd: projectPath,
    absolute: true
  });

  console.log('🔧 Optimizing ' + componentFiles.length + ' stub files...');
  
  let optimized = 0;
  
  for (const filePath of componentFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    if (content.includes('// NUCLEAR OPTIMIZED')) {
      const fileName = path.basename(filePath, path.extname(filePath));
      
      // Parse exports from the stub
      const exportMatch = content.match(/export \{ ([^}]+) \}/);
      const defaultMatch = content.match(/export default (\w+);/);
      
      if (exportMatch) {
        const exports = exportMatch[1].split(',').map(e => e.trim());
        
        // Create ultra-minimal stubs - NO React import needed!
        let newContent = '// NUCLEAR OPTIMIZED - Ultra-minimal stubs\n';
        
        for (const exportName of exports) {
          if (exportName.endsWith('Variants') || exportName.includes('Style')) {
            // Style/variant exports - just empty object
            newContent += `export const ${exportName} = {};\n`;
          } else if (exportName.startsWith('use')) {
            // Hooks - return empty object
            newContent += `export const ${exportName} = () => ({});\n`;
          } else if (exportName.match(/^[A-Z]/)) {
            // Components - minimal React element (no React import!)
            newContent += `export const ${exportName} = () => null;\n`;
          } else {
            // Other exports - empty function
            newContent += `export const ${exportName} = () => {};\n`;
          }
        }
        
        // Handle default export if present
        if (defaultMatch) {
          const defaultName = defaultMatch[1];
          // Find which export should be default
          const mainExport = exports.find(e => 
            e.toLowerCase() === fileName.replace(/-/g, '').toLowerCase()
          ) || exports[0];
          if (mainExport) {
            newContent += `export default ${mainExport};\n`;
          }
        }
        
        // Write optimized content
        fs.writeFileSync(filePath, newContent);
        optimized++;
        console.log('  ✓ ' + path.basename(filePath));
      }
    }
  }
  
  console.log('✅ Optimized ' + optimized + ' stub files');
  return optimized;
}

// Run if called directly
if (require.main === module) {
  const projectPath = process.argv[2] || process.cwd();
  optimizeStubs(projectPath).catch(console.error);
}

module.exports = { optimizeStubs };
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function deleteUnusedComponents(projectPath) {
  // Components that are actually used
  const usedComponents = new Set([
    'badge',
    'button', 
    'card',
    'tabs',
    'toaster',
    'tooltip',
    'toast', // toaster depends on toast
    'code-block'
  ]);

  const componentsDir = path.join(projectPath, 'client/src/components/ui');
  const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx'));
  
  console.log('🗑️  Deleting truly unused components...');
  
  let deleted = 0;
  
  for (const file of files) {
    const componentName = file.replace('.tsx', '');
    
    if (!usedComponents.has(componentName)) {
      const filePath = path.join(componentsDir, file);
      fs.unlinkSync(filePath);
      deleted++;
      console.log(`  ✓ Deleted: ${file}`);
    }
  }
  
  console.log(`\n✅ Deleted ${deleted} unused components`);
  console.log(`📦 Kept ${usedComponents.size} used components`);
  
  return deleted;
}

// Run if called directly
if (require.main === module) {
  const projectPath = process.argv[2] || process.cwd();
  deleteUnusedComponents(projectPath);
}

module.exports = { deleteUnusedComponents };
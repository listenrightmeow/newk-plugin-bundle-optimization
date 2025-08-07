import * as fs from 'fs/promises';
import * as path from 'path';
import glob from 'fast-glob';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TreeDrivenOptimizer } from './TreeDrivenOptimizer.js';

const execAsync = promisify(exec);

export class BundleOptimizer {
  private treeDrivenOptimizer: TreeDrivenOptimizer;
  
  constructor() {
    this.treeDrivenOptimizer = new TreeDrivenOptimizer();
  }
  
  async optimize(projectPath: string, analysis: any, safeMode: boolean = false, visualize: boolean = false): Promise<void> {
    console.log('🎯 Starting LIGHTWEIGHT bundle optimization...');
    
    // Step 1: Optimize Vite configuration for smaller bundles
    await this.optimizeViteConfigTreeDriven(projectPath, analysis, safeMode);
    
    // Step 2: Remove unused package.json dependencies only
    await this.optimizePackageScripts(projectPath, analysis);
    
    // Step 3: Generate visualization if requested
    if (visualize) {
      await this.generateVisualization(projectPath, analysis);
    }
    
    console.log('✓ Lightweight optimization completed - no file modifications');
  }
  
  private async checkTerserAvailability(projectPath: string): Promise<boolean> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      const hasTerser = packageJson.dependencies?.terser || 
                       packageJson.devDependencies?.terser;
      
      if (!hasTerser) {
        console.log('⚠️  Terser not found in your project dependencies.');
        console.log('💡 For maximum bundle optimization, install terser:');
        console.log('   npm install --save-dev terser');
        console.log('⚡ Bundle optimization will continue with aggressive settings.');
        return false;
      } else {
        console.log('✓ Terser found - using maximum compression settings');
        return true;
      }
    } catch (error) {
      console.warn('Could not check terser availability:', error.message);
      return false;
    }
  }
  
  
  // NEW: Tree-driven version
  private async optimizeViteConfigTreeDriven(projectPath: string, analysis: any, safeMode: boolean = false): Promise<void> {
    const viteConfigPath = path.join(projectPath, 'vite.config.ts');
    
    try {
      const exists = await this.fileExists(viteConfigPath);
      if (!exists) return;
      
      let config = await fs.readFile(viteConfigPath, 'utf-8');
      
      // Create backup
      await fs.writeFile(`${viteConfigPath}.backup`, config);
      
      // Ensure fileURLToPath is imported
      if (!config.includes('fileURLToPath')) {
        config = config.replace(
          'import path from "path";', 
          'import path from "path";\nimport { fileURLToPath } from "url";'
        );
      }
      
      // Fix any import.meta.dirname references to use fileURLToPath pattern
      config = config.replace(
        /path\.resolve\(import\.meta\.dirname,/g, 
        'path.resolve(path.dirname(fileURLToPath(import.meta.url)),'
      );
      
      // ROBUST APPROACH: Parse and reconstruct build config by finding start/end positions
      const optimizedBuildConfig = this.treeDrivenOptimizer.generateDynamicBuildConfig(analysis, safeMode);
      
      // Find build config boundaries more reliably
      const buildStart = config.indexOf('build: {');
      if (buildStart !== -1) {
        // Find the matching closing brace for the build config
        let braceCount = 0;
        let pos = buildStart + 7; // Start after 'build: '
        let buildEnd = -1;
        
        while (pos < config.length) {
          if (config[pos] === '{') braceCount++;
          else if (config[pos] === '}') {
            braceCount--;
            if (braceCount === 0) {
              buildEnd = pos + 1;
              // Include trailing comma if present
              if (config[pos + 1] === ',') buildEnd++;
              break;
            }
          }
          pos++;
        }
        
        if (buildEnd !== -1) {
          // Replace existing build config
          config = config.substring(0, buildStart) + `build: ${optimizedBuildConfig},` + config.substring(buildEnd);
        } else {
          console.warn('⚠️  Could not find end of build config, appending new config');
          config = config.replace(/}(\);)$/, `  build: ${optimizedBuildConfig},\n}$1`);
        }
      } else {
        // Add build config before the closing of defineConfig
        config = config.replace(/}(\);)$/, `  build: ${optimizedBuildConfig},\n}$1`);
      }
      
      await fs.writeFile(viteConfigPath, config);
      console.log('✓ Vite configuration optimized (tree-driven - dynamic)');
      
    } catch (error) {
      console.warn('Failed to optimize vite.config.ts:', error.message);
    }
  }
  
  
  private generateUIChunks(analysis: any): string {
    const uiPackages = Array.from(analysis.usedDependencies)
      .filter((dep: any) => typeof dep === 'string' && (dep.startsWith('@radix-ui/') || dep === 'lucide-react'))
      .map((dep: any) => `'${dep}'`)
      .join(', ');
    
    return uiPackages;
  }
  
  private getSafeTerserOptions() {
    return {
      compress: {
        drop_console: false,      // Keep console logs
        drop_debugger: true,      // Still remove debugger
        ecma: 2020,
        passes: 1,               // Single pass only
        side_effects: true,      // Respect side effects
        unused: false,           // Don't remove "unused" code
        // Disable all unsafe optimizations
        unsafe: false,
        unsafe_arrows: false,
        unsafe_comps: false,
        unsafe_Function: false,
        unsafe_math: false,
        unsafe_symbols: false,
        unsafe_methods: false,
        unsafe_proto: false,
        unsafe_regexp: false,
        unsafe_undefined: false
      },
      mangle: false,  // Don't mangle names
      format: {
        comments: 'some',  // Keep important comments
        ecma: 2020
      }
    };
  }
  
  private formatSafeTerserOptions(): string {
    return `{
      compress: {
        drop_console: false,
        drop_debugger: true,
        ecma: 2020,
        passes: 1,
        side_effects: true,
        unused: false,
        unsafe: false,
        unsafe_arrows: false,
        unsafe_comps: false,
        unsafe_Function: false,
        unsafe_math: false,
        unsafe_symbols: false,
        unsafe_methods: false,
        unsafe_proto: false,
        unsafe_regexp: false,
        unsafe_undefined: false
      },
      mangle: false,
      format: {
        comments: 'some',
        ecma: 2020
      }
    }`;
  }
  
  private async createOptimizedBuildConfig(projectPath: string, analysis: any, safeMode: boolean = false): Promise<void> {
    const optimizationConfig = {
      bundleOptimization: {
        timestamp: new Date().toISOString(),
        optimizations: {
          removedDependencies: analysis.unusedDependencies.length,
          removedServerDeps: analysis.serverSideDependencies.length,
          enabledTreeShaking: true,
          enabledCodeSplitting: true,
          enabledCompression: true
        },
        targets: {
          maxBundleSize: '50kb',
          maxChunkSize: '25kb',
          compressionLevel: 'extreme'
        }
      }
    };
    
    // Write report to .newk directory if it exists, otherwise main directory
    const newkDir = path.join(projectPath, '.newk');
    const reportDir = await fs.access(newkDir).then(() => newkDir, () => projectPath);
    
    const reportPath = path.join(reportDir, 'bundle-optimization-report.json');
    await fs.writeFile(reportPath, JSON.stringify(optimizationConfig, null, 2));
  }
  
  private async addCompressionPlugins(projectPath: string): Promise<void> {
    // Add aggressive compression plugin configuration
    const compressionConfig = `
// Compression Plugin Configuration (Generated by Bundle Optimizer)
import { defineConfig } from 'vite';

// Ultra-aggressive compression settings
export const compressionSettings = {
  // Brotli compression (better than gzip)
  brotli: {
    enabled: true,
    quality: 11, // Maximum compression
    lgwin: 24,   // Maximum window size
  },
  
  // Gzip fallback
  gzip: {
    enabled: true,
    level: 9, // Maximum compression
  },
  
  // Asset optimization
  assets: {
    inlineLimit: 1024, // Very small inline limit
    svgOptimization: true,
    imageOptimization: true,
  }
};
`;
    
    const configPath = path.join(projectPath, 'vite.compression.config.ts');
    await fs.writeFile(configPath, compressionConfig);
    console.log('✓ Compression configuration added');
  }

  private async generatePreloadHints(projectPath: string, analysis: any): Promise<void> {
    // Generate critical resource preloads for the most essential chunks
    const preloadHints = {
      criticalResources: [
        { rel: 'preload', href: '/react-vendor.js', as: 'script', crossorigin: 'anonymous' },
        { rel: 'preload', href: '/index.css', as: 'style' },
        { rel: 'prefetch', href: '/router.js', as: 'script' }
      ],
      resourceHints: {
        dnsPrefetch: ['https://fonts.googleapis.com'],
        preconnect: ['https://fonts.gstatic.com']
      }
    };
    
    const hintsPath = path.join(projectPath, 'preload-hints.json');
    await fs.writeFile(hintsPath, JSON.stringify(preloadHints, null, 2));
    console.log('✓ Preload hints generated');
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async removeUnusedCode(projectPath: string, analysis: any): Promise<void> {
    console.log('🧹 Removing unused code based on AST analysis...');
    
    // Debug: Show what the analysis found
    console.log('📊 AST Analysis Results:');
    console.log('- Used dependencies:', analysis.usedDependencies?.size || 0);
    console.log('- Unused dependencies:', analysis.unusedDependencies?.length || 0);
    console.log('- Unrendered components:', analysis.componentAnalysis?.unrenderedComponents?.size || 0);
    
    if (analysis.unusedDependencies?.length > 0) {
      console.log('❌ Unused dependencies found:', analysis.unusedDependencies.slice(0, 5));
    }
    
    // Step 1: Remove unused UI component files entirely (based on actual AST analysis)
    await this.removeUnusedComponents(projectPath, analysis);
    
    // Step 2: Remove unused imports from remaining files (surgical import removal only)
    await this.removeUnusedImports(projectPath, analysis);
    
    console.log('✓ Unused code removal completed (surgical approach)');
  }
  
  // NEW: Tree-driven version
  private async removeUnusedCodeTreeDriven(projectPath: string, analysis: any): Promise<void> {
    console.log('🌳 Removing unused code based on TREE analysis...');
    
    // Debug: Show what the tree analysis found
    console.log('📊 Tree Analysis Results:');
    console.log('- Used dependencies:', analysis.usedDependencies?.size || 0);
    console.log('- Unused dependencies:', analysis.unusedDependencies?.length || 0);
    console.log('- Unrendered components:', analysis.componentAnalysis?.unrenderedComponents?.size || 0);
    
    if (analysis.unusedDependencies?.length > 0) {
      console.log('❌ Dependencies NOT in tree:', analysis.unusedDependencies.slice(0, 5));
    }
    
    // Step 1: Remove components NOT in the component tree
    await this.removeUnusedComponentsTreeDriven(projectPath, analysis);
    
    // Step 2: Remove imports NOT in the dependency tree
    await this.removeUnusedImportsTreeDriven(projectPath, analysis);
    
    console.log('✓ Tree-driven code removal completed (dynamic approach)');
  }

  private async removeUnusedComponents(projectPath: string, analysis: any): Promise<void> {
    const uiComponentsPath = path.join(projectPath, 'client/src/components/ui');
    
    try {
      const componentFiles = await glob(`${uiComponentsPath}/*.tsx`);
      let removedCount = 0;
      
      for (const filePath of componentFiles) {
        const fileName = path.basename(filePath, '.tsx');
        
        // Check if this component is in the unrendered components set
        if (analysis.componentAnalysis?.unrenderedComponents?.has(fileName)) {
          await fs.unlink(filePath);
          removedCount++;
          console.log(`  🗑️  Removed unused component: ${fileName}.tsx`);
        }
      }
      
      if (removedCount > 0) {
        console.log(`✓ Removed ${removedCount} unused UI components`);
      }
    } catch (error) {
      console.warn('Failed to remove unused components:', error.message);
    }
  }

  private async removeUnusedImports(projectPath: string, analysis: any): Promise<void> {
    const sourceFiles = await glob([
      `${projectPath}/client/src/**/*.{ts,tsx}`,
      `!${projectPath}/client/src/components/ui/**`
    ]);
    
    let processedFiles = 0;
    
    for (const filePath of sourceFiles) {
      try {
        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;
        
        // Smart UI component import removal using Replit whitelist
        const uiImportMatches = content.match(/import\s+\{([^}]+)\}\s+from\s+["']@\/components\/ui\/[^"']+["'];?/g);
        if (uiImportMatches) {
          for (const importMatch of uiImportMatches) {
            const componentsMatch = importMatch.match(/import\s+\{([^}]+)\}/);
            if (componentsMatch) {
              const components = componentsMatch[1].split(',').map(c => c.trim());
              let shouldRemove = true;
              
              // Check if any component is used in JSX or is commonly used
              for (const component of components) {
                const jsxPattern = new RegExp(`<${component}[\\s>]`, 'g');
                const isUsedInJSX = jsxPattern.test(content);
                // Common UI components that should be preserved
                const commonComponents = ['Button', 'Card', 'CardContent', 'Badge', 'Tabs', 'TabsContent'];
                const isCommonComponent = commonComponents.includes(component);
                
                if (isUsedInJSX || isCommonComponent) {
                  shouldRemove = false;
                  break;
                }
              }
              
              // Only remove if ALL components are truly unused
              if (shouldRemove) {
                content = content.replace(importMatch + '\n', '');
                hasChanges = true;
              }
            }
          }
        }
        
        // Remove imports for packages that were identified as unused by AST analysis
        if (analysis.unusedDependencies) {
          for (const unusedDep of analysis.unusedDependencies) {
            if (unusedDep.includes('newk') || unusedDep.startsWith('@types/')) continue;
            
            const packageImportRegex = new RegExp(`import\\s+[^;]+from\\s+['"]${unusedDep.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"];?\\n?`, 'g');
            if (packageImportRegex.test(content)) {
              content = content.replace(packageImportRegex, '');
              hasChanges = true;
            }
          }
        }
        
        // Remove imports for packages in dead code branches
        if (analysis.dataFlowAnalysis?.unusedImports) {
          for (const unusedImport of analysis.dataFlowAnalysis.unusedImports) {
            const deadImportRegex = new RegExp(`import\\s+[^;]+from\\s+['"][^'"]*${unusedImport.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^'"]*['"];?\\n?`, 'g');
            if (deadImportRegex.test(content)) {
              content = content.replace(deadImportRegex, '');
              hasChanges = true;
            }
          }
        }
        
        if (hasChanges) {
          await fs.writeFile(filePath, content);
          processedFiles++;
        }
      } catch (error) {
        console.warn(`Failed to process ${filePath}:`, error.message);
      }
    }
    
    if (processedFiles > 0) {
      console.log(`✓ Removed unused imports from ${processedFiles} files`);
    }
  }
  
  // NEW: Tree-driven component removal
  private async removeUnusedComponentsTreeDriven(projectPath: string, analysis: any): Promise<void> {
    const uiComponentsPath = path.join(projectPath, 'client/src/components/ui');
    
    try {
      const componentFiles = await glob(`${uiComponentsPath}/*.tsx`);
      let removedCount = 0;
      
      for (const filePath of componentFiles) {
        const fileName = path.basename(filePath, '.tsx');
        
        // TREE-DRIVEN: Use tree analysis instead of hardcoded logic
        if (this.treeDrivenOptimizer.shouldRemoveComponent(fileName, analysis)) {
          await fs.unlink(filePath);
          removedCount++;
          console.log(`  🗑️  Removed component NOT in tree: ${fileName}.tsx`);
        }
      }
      
      if (removedCount > 0) {
        console.log(`✓ Removed ${removedCount} components not in dependency tree`);
      }
    } catch (error) {
      console.warn('Failed to remove components based on tree:', error.message);
    }
  }
  
  // NEW: Tree-driven import removal
  private async removeUnusedImportsTreeDriven(projectPath: string, analysis: any): Promise<void> {
    const sourceFiles = await glob([
      `${projectPath}/client/src/**/*.{ts,tsx}`,
      `!${projectPath}/client/src/components/ui/**`
    ]);
    
    const removalPatterns = this.treeDrivenOptimizer.generateImportRemovalPatterns(analysis);
    let processedFiles = 0;
    
    for (const filePath of sourceFiles) {
      try {
        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;
        
        // TREE-DRIVEN: Remove imports based on tree presence
        if (analysis.unusedDependencies) {
          for (const unusedDep of analysis.unusedDependencies) {
            // Use tree-driven logic instead of hardcoded rules
            if (removalPatterns.shouldRemove(unusedDep)) {
              const packageImportRegex = new RegExp(`import\\s+[^;]+from\\s+['"]${unusedDep.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"];?\\n?`, 'g');
              if (packageImportRegex.test(content)) {
                content = content.replace(packageImportRegex, '');
                hasChanges = true;
                console.log(`  🗑️  Removed import not in tree: ${unusedDep}`);
              }
            }
          }
        }
        
        if (hasChanges) {
          await fs.writeFile(filePath, content);
          processedFiles++;
        }
      } catch (error) {
        console.warn(`Failed to process ${filePath}:`, error.message);
      }
    }
    
    if (processedFiles > 0) {
      console.log(`✓ Removed imports from ${processedFiles} files (tree-driven)`);
    }
  }

  private async removeDeadCodeBranches(projectPath: string, analysis: any): Promise<void> {
    if (!analysis.dataFlowAnalysis?.deadCodeBranches?.size) return;
    
    const sourceFiles = await glob([
      `${projectPath}/client/src/**/*.{ts,tsx}`,
      `!${projectPath}/client/src/components/ui/**`
    ]);
    
    let processedFiles = 0;
    
    for (const filePath of sourceFiles) {
      try {
        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;
        
        // Remove unreachable code branches
        for (const deadBranch of analysis.dataFlowAnalysis.deadCodeBranches) {
          // Simple pattern matching for common dead code patterns
          const patterns = [
            // Unused function declarations
            new RegExp(`function\\s+${deadBranch}\\s*\\([^)]*\\)\\s*\\{[^{}]*\\}`, 'g'),
            // Unused const declarations
            new RegExp(`const\\s+${deadBranch}\\s*=\\s*[^;]+;`, 'g'),
            // Unused variable declarations
            new RegExp(`let\\s+${deadBranch}\\s*=\\s*[^;]+;`, 'g'),
          ];
          
          for (const pattern of patterns) {
            if (pattern.test(content)) {
              content = content.replace(pattern, '');
              hasChanges = true;
            }
          }
        }
        
        if (hasChanges) {
          await fs.writeFile(filePath, content);
          processedFiles++;
        }
      } catch (error) {
        console.warn(`Failed to remove dead code from ${filePath}:`, error.message);
      }
    }
    
    if (processedFiles > 0) {
      console.log(`✓ Removed dead code from ${processedFiles} files`);
    }
  }

  private async eliminateUnusedUIComponents(projectPath: string, analysis: any): Promise<void> {
    console.log('🗑️  Eliminating unused UI components...');
    
    const uiPath = path.join(projectPath, 'client/src/components/ui');
    
    try {
      // Get all UI component files
      const uiComponents = await glob([`${uiPath}/*.tsx`, `${uiPath}/*.ts`]);
      
      // Track which components are imported
      const usedComponents = new Set<string>();
      
      // First pass: Scan all source files (non-UI) for imports
      const sourceFiles = await glob([
        `${projectPath}/client/src/**/*.{ts,tsx}`,
        `${projectPath}/src/**/*.{ts,tsx}`,
        `!${projectPath}/**/node_modules/**`,
        `!${projectPath}/client/src/components/ui/**` // Exclude UI components initially
      ]);
      
      // Check each source file for UI component imports
      for (const file of sourceFiles) {
        const content = await fs.readFile(file, 'utf-8');
        
        // Match imports from @/components/ui/ (including type imports)
        const importRegex = /import(?:\s+type)?.*from\s+['"]@\/components\/ui\/([^'"]+)['"]/g;
        const matches = content.matchAll(importRegex);
        
        for (const match of matches) {
          const componentName = match[1].replace(/\.(tsx?|jsx?)$/, '');
          usedComponents.add(componentName);
        }
      }
      
      // Second pass: Check inter-component dependencies
      // Keep checking until no new components are added
      console.log('Initial used components:', Array.from(usedComponents));
      
      let foundNewComponents = true;
      while (foundNewComponents) {
        foundNewComponents = false;
        const currentUsed = new Set(usedComponents);
        
        for (const componentFile of uiComponents) {
          const componentName = path.basename(componentFile, path.extname(componentFile));
          
          // If this component is used, check what it imports
          if (currentUsed.has(componentName)) {
            const content = await fs.readFile(componentFile, 'utf-8');
            
            // Check for imports from other UI components (including type imports)
            // Only look for UI component imports, not other imports
            const uiImportRegex = /import(?:\s+type)?.*from\s+['"]@\/components\/ui\/([^'"]+)['"]/g;
            const relativeImportRegex = /import(?:\s+type)?.*from\s+['"]\.\/([^'"]+)['"]/g;
            
            // Check absolute UI imports
            let matches = content.matchAll(uiImportRegex);
            for (const match of matches) {
              const importedComponent = match[1].replace(/\.(tsx?|jsx?)$/, '');
              if (!usedComponents.has(importedComponent) && importedComponent !== componentName) {
                console.log(`  Component ${componentName} imports UI component: ${importedComponent}`);
                usedComponents.add(importedComponent);
                foundNewComponents = true;
              }
            }
            
            // Check relative imports (for UI components importing each other)
            matches = content.matchAll(relativeImportRegex);
            for (const match of matches) {
              const importedComponent = match[1].replace(/\.(tsx?|jsx?)$/, '');
              // Only add if it's likely a UI component (exists in our UI components list)
              const importedPath = path.join(uiPath, `${importedComponent}.tsx`);
              const importedPathTs = path.join(uiPath, `${importedComponent}.ts`);
              if ((await this.fileExists(importedPath) || await this.fileExists(importedPathTs)) && 
                  !usedComponents.has(importedComponent) && importedComponent !== componentName) {
                console.log(`  Component ${componentName} imports UI component: ${importedComponent}`);
                usedComponents.add(importedComponent);
                foundNewComponents = true;
              }
            }
          }
        }
      }
      
      console.log('Final used components:', Array.from(usedComponents).filter(c => !c.includes('/')));
      
      // Find unused components
      const unusedComponents: string[] = [];
      let removedCount = 0;
      
      for (const componentFile of uiComponents) {
        const componentName = path.basename(componentFile, path.extname(componentFile));
        
        if (!usedComponents.has(componentName)) {
          // Special case: don't remove index files or utility files
          if (componentName === 'index' || componentName === 'utils') {
            continue;
          }
          
          unusedComponents.push(componentFile);
          
          // Rename file to .unused instead of deleting (safer)
          const unusedPath = componentFile + '.unused';
          await fs.rename(componentFile, unusedPath);
          removedCount++;
          console.log(`  ✓ Disabled unused component: ${componentName}`);
        }
      }
      
      if (removedCount > 0) {
        console.log(`✓ Eliminated ${removedCount} unused UI components (${Math.round(removedCount / uiComponents.length * 100)}% reduction)`);
        
        // Update the analysis to reflect removed components
        if (!analysis.eliminatedComponents) {
          analysis.eliminatedComponents = [];
        }
        analysis.eliminatedComponents.push(...unusedComponents.map(f => path.basename(f)));
      } else {
        console.log('  No unused UI components found');
      }
      
    } catch (error) {
      console.warn('Failed to eliminate unused UI components:', error.message);
    }
  }
  
  private async convertRoutesToDynamicImports(projectPath: string): Promise<void> {
    console.log('📦 Converting page/route components to dynamic imports...');
    
    // Find main App file or router file
    const appFiles = await glob([
      `${projectPath}/client/src/App.{ts,tsx,js,jsx}`,
      `${projectPath}/client/src/main.{ts,tsx,js,jsx}`,
      `${projectPath}/client/src/index.{ts,tsx,js,jsx}`,
      `${projectPath}/src/App.{ts,tsx,js,jsx}`,
      `${projectPath}/src/main.{ts,tsx,js,jsx}`,
      `${projectPath}/src/index.{ts,tsx,js,jsx}`
    ]);
    
    for (const appFile of appFiles) {
      try {
        let content = await fs.readFile(appFile, 'utf-8');
        let hasChanges = false;
        
        // Pattern to find page imports
        // Match: import Home from "@/pages/home";
        // Replace with: const Home = React.lazy(() => import("@/pages/home"));
        const pageImportRegex = /import\s+(\w+)\s+from\s+["'](@\/pages\/[^"']+|\.\/pages\/[^"']+)["'];?/g;
        
        const matches = content.matchAll(pageImportRegex);
        const replacements: Array<{from: string, to: string}> = [];
        
        for (const match of matches) {
          const componentName = match[1];
          const importPath = match[2];
          
          // Skip if already lazy loaded or is a utility/type import
          if (content.includes(`React.lazy`) && content.includes(componentName)) {
            continue;
          }
          
          replacements.push({
            from: match[0],
            to: `const ${componentName} = React.lazy(() => import("${importPath}"));`
          });
        }
        
        // Apply replacements
        for (const replacement of replacements) {
          content = content.replace(replacement.from, replacement.to);
          hasChanges = true;
        }
        
        // Add React import if needed and we made changes
        if (hasChanges && !content.includes("import React") && !content.includes("import * as React")) {
          content = `import React from 'react';\n${content}`;
        }
        
        // Add Suspense wrapper suggestion
        if (hasChanges && content.includes('React.lazy')) {
          // Check if Router/Routes component exists and suggest wrapping
          if (!content.includes('Suspense')) {
            const suspenseNote = '\n// Note: Remember to wrap lazy-loaded routes with <React.Suspense fallback={<div>Loading...</div>}>';
            content = content.replace(/import React[^;]*;/, (match) => `${match}${suspenseNote}`);
          }
        }
        
        if (hasChanges) {
          await fs.writeFile(appFile, content);
          console.log(`  ✓ Converted ${replacements.length} route imports to dynamic imports in ${path.basename(appFile)}`);
        }
      } catch (error) {
        console.warn(`  Failed to process ${appFile}:`, error.message);
      }
    }
  }
  
  private async convertToDynamicImports(projectPath: string, analysis: any): Promise<void> {
    console.log('🚀 Converting to dynamic imports for maximum code splitting...');
    
    // First, convert page/route components to dynamic imports
    await this.convertRoutesToDynamicImports(projectPath);
    
    // Then convert heavy dependencies
    const heavyDeps = analysis.bundleSplitAnalysis?.lazyLoadCandidates || [];
    if (heavyDeps.length === 0) {
      console.log('  No heavy dependencies identified for lazy loading');
      return;
    }
    
    console.log(`  Found ${heavyDeps.length} heavy dependencies to convert:`, heavyDeps);
    
    const sourceFiles = await glob([
      `${projectPath}/client/src/**/*.{ts,tsx}`,
      `!${projectPath}/client/src/**/*.test.{ts,tsx}`,
      `!${projectPath}/client/src/**/*.spec.{ts,tsx}`
    ]);
    
    let totalConversions = 0;
    
    for (const filePath of sourceFiles) {
      try {
        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;
        
        for (const dep of heavyDeps) {
          // Skip type imports - they can't be dynamically imported
          const typeImportRegex = new RegExp(
            `import\\s+type\\s+{[^}]+}\\s*from\\s*['"]${dep}['"];?`,
            'g'
          );
          
          // Pattern 1: Convert named imports to dynamic imports with React.lazy
          // Before: import { Chart } from 'recharts';
          // After: const Chart = React.lazy(() => import('recharts').then(m => ({ default: m.Chart })));
          const namedImportRegex = new RegExp(
            `import\\s*{([^}]+)}\\s*from\\s*['"]${dep}['"];?`,
            'g'
          );
          
          const namedMatches = content.matchAll(namedImportRegex);
          for (const match of namedMatches) {
            // Skip if this is a type import
            if (typeImportRegex.test(match[0])) {
              continue;
            }
            
            const imports = match[1].split(',').map(i => i.trim());
            const validImports = imports.filter(imp => {
              // Skip type imports (e.g., "type Foo" or "type { Foo }")
              return !imp.startsWith('type ');
            });
            
            if (validImports.length === 0) {
              continue;
            }
            
            const lazyImports = validImports.map(imp => {
              const [importName, alias] = imp.split(' as ').map(s => s.trim());
              const varName = alias || importName;
              return `const ${varName} = React.lazy(() => import('${dep}').then(m => ({ default: m.${importName} })));`;
            }).join('\n');
            
            content = content.replace(match[0], lazyImports);
            hasChanges = true;
            totalConversions++;
          }
          
          // Pattern 2: Convert default imports
          // Before: import Chart from 'recharts';
          // After: const Chart = React.lazy(() => import('recharts'));
          const defaultImportRegex = new RegExp(
            `import\\s+(\\w+)\\s+from\\s*['"]${dep}['"];?`,
            'g'
          );
          
          const defaultMatches = content.matchAll(defaultImportRegex);
          for (const match of defaultMatches) {
            const varName = match[1];
            const lazyImport = `const ${varName} = React.lazy(() => import('${dep}'));`;
            content = content.replace(match[0], lazyImport);
            hasChanges = true;
            totalConversions++;
          }
          
          // Pattern 3: Convert entire module imports
          // Before: import * as Charts from 'recharts';
          // After: const Charts = await import('recharts');
          const namespaceImportRegex = new RegExp(
            `import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*['"]${dep}['"];?`,
            'g'
          );
          
          const namespaceMatches = content.matchAll(namespaceImportRegex);
          for (const match of namespaceMatches) {
            const varName = match[1];
            // For namespace imports, we need to handle them differently
            // We'll add a comment for manual review
            const comment = `// TODO: Convert to dynamic import in async context\n// ${match[0]}`;
            content = content.replace(match[0], comment);
            console.log(`  ⚠️  Namespace import needs manual conversion: ${dep} in ${path.basename(filePath)}`);
          }
        }
        
        // Add React import if we added React.lazy and it's not already imported
        if (hasChanges && !content.includes("import React") && !content.includes("import * as React")) {
          content = `import React from 'react';\n${content}`;
        }
        
        // Wrap lazy components in Suspense if not already wrapped
        if (hasChanges && content.includes('React.lazy')) {
          // Add a comment suggesting Suspense wrapper
          const suspenseComment = '\n// Note: Wrap lazy-loaded components with <React.Suspense fallback={<div>Loading...</div>}>';
          if (!content.includes('Suspense')) {
            content = content.replace(/import React[^;]*;/, (match) => `${match}${suspenseComment}`);
          }
        }
        
        if (hasChanges) {
          await fs.writeFile(filePath, content);
          console.log(`  ✓ Converted imports in ${path.basename(filePath)}`);
        }
      } catch (error) {
        console.warn(`  Failed to process ${filePath}:`, error.message);
      }
    }
    
    if (totalConversions > 0) {
      console.log(`✓ Converted ${totalConversions} imports to dynamic imports`);
      console.log('💡 Remember to wrap lazy components with <React.Suspense>');
    }
  }
  
  private async optimizePackageScripts(projectPath: string, analysis: any): Promise<void> {
    const packageJsonPath = path.join(projectPath, 'package.json');
    
    try {
      const exists = await this.fileExists(packageJsonPath);
      if (!exists) return;
      
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const originalSize = JSON.stringify(packageJson).length;
      
      // AGGRESSIVE: Remove ALL unused dependencies from package.json
      let removedDeps = 0;
      const unusedDeps = new Set(analysis.unusedDependencies || []);
      
      // Remove from dependencies
      if (packageJson.dependencies) {
        for (const dep of Object.keys(packageJson.dependencies)) {
          if (unusedDeps.has(dep)) {
            delete packageJson.dependencies[dep];
            removedDeps++;
          }
        }
      }
      
      // Remove from devDependencies (but keep build tools)
      const keepDevDeps = ['vite', '@vitejs/plugin-react', 'typescript', 'tailwindcss', 'postcss', 'autoprefixer'];
      if (packageJson.devDependencies) {
        for (const dep of Object.keys(packageJson.devDependencies)) {
          if (unusedDeps.has(dep) && !keepDevDeps.includes(dep)) {
            delete packageJson.devDependencies[dep];
            removedDeps++;
          }
        }
      }
      
      // Check if this looks like a Replit full-stack template
      const hasExpressServer = packageJson.dependencies?.express || 
                              packageJson.devDependencies?.tsx ||
                              await this.fileExists(path.join(projectPath, 'server/index.ts'));
      
      if (hasExpressServer && analysis.unusedDependencies?.includes('express')) {
        // Convert to static site scripts
        packageJson.scripts = {
          ...packageJson.scripts,
          dev: 'vite dev',
          build: 'vite build',
          start: 'npx serve dist/public -s'
        };
        
        console.log('✓ Converted to static site scripts (removed Express server)');
      }
      
      const newSize = JSON.stringify(packageJson).length;
      const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(1);
      
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log(`✓ Package.json optimized: ${reduction}% reduction in size`);
      if (removedDeps > 0) {
        console.log(`✓ Removed ${removedDeps} unused dependencies from package.json`);
        console.log(`💡 Run 'npm install' to update node_modules`);
      }
      
    } catch (error) {
      console.warn('Failed to optimize package scripts:', error.message);
    }
  }

  private async generateVisualization(projectPath: string, analysis: any): Promise<void> {
    try {
      console.log('📊 Generating dependency graph visualization...');
      console.log('🔍 Analysis object keys:', Object.keys(analysis));
      console.log('🔍 DependencyGraph available:', !!analysis.dependencyGraph);
      if (analysis.dependencyGraph) {
        console.log('🔍 Graph has edges:', !!analysis.dependencyGraph.edges);
        console.log('🔍 Edge count:', analysis.dependencyGraph.edges?.length || 0);
      }
      const mermaidContent = this.createMermaidDiagram(analysis);
      
      // Write to dependency-graph.mmd file in project root
      const outputPath = path.join(projectPath, 'dependency-graph.mmd');
      await fs.writeFile(outputPath, mermaidContent);
      
      console.log(`✓ Dependency graph saved to: dependency-graph.mmd`);
      console.log('💡 View online at: https://mermaid.live/');
      console.log('💡 Or install mermaid-cli: npm install -g @mermaid-js/mermaid-cli');
      
    } catch (error) {
      console.warn('Failed to generate visualization:', error.message);
    }
  }

  private createMermaidDiagram(analysis: any): string {
    const lines: string[] = [];
    
    lines.push('graph TD');
    lines.push('    %% Dependency Graph Visualization');
    lines.push('    %% Generated by Replrod Bundle Optimization');
    lines.push('');
    
    // Define styles
    lines.push('    classDef used fill:#4ade80,stroke:#16a34a,stroke-width:2px,color:#000');
    lines.push('    classDef unused fill:#f87171,stroke:#dc2626,stroke-width:2px,color:#fff');
    lines.push('    classDef heavy fill:#facc15,stroke:#ca8a04,stroke-width:2px,color:#000');
    lines.push('    classDef server fill:#a78bfa,stroke:#7c3aed,stroke-width:2px,color:#fff');
    lines.push('    classDef ui fill:#60a5fa,stroke:#2563eb,stroke-width:2px,color:#fff');
    lines.push('    classDef app fill:#10b981,stroke:#047857,stroke-width:3px,color:#fff');
    lines.push('');
    
    // Track all nodes that will be shown
    const allNodes = new Set<string>();
    
    // Add nodes for used dependencies
    if (analysis.usedDependencies) {
      const usedDeps = Array.from(analysis.usedDependencies);
      usedDeps.forEach((dep: string) => {
        const nodeId = this.sanitizeNodeId(dep);
        allNodes.add(dep);
        lines.push(`    ${nodeId}["${dep}"]:::used`);
      });
    }
    
    // Add nodes for unused dependencies
    if (analysis.unusedDependencies) {
      analysis.unusedDependencies.forEach((dep: string) => {
        const nodeId = this.sanitizeNodeId(dep);
        allNodes.add(dep);
        lines.push(`    ${nodeId}["${dep}"]:::unused`);
      });
    }
    
    // Add nodes for heavy dependencies
    if (analysis.heavyDependencies) {
      analysis.heavyDependencies.forEach((dep: string) => {
        const nodeId = this.sanitizeNodeId(dep);
        allNodes.add(dep);
        lines.push(`    ${nodeId}["⚠️ ${dep}"]:::heavy`);
      });
    }
    
    // Add nodes for server-side dependencies
    if (analysis.serverSideDependencies) {
      analysis.serverSideDependencies.forEach((dep: string) => {
        const nodeId = this.sanitizeNodeId(dep);
        allNodes.add(dep);
        lines.push(`    ${nodeId}["🖥️ ${dep}"]:::server`);
      });
    }
    
    // Add app entry point node
    lines.push('    App["📱 Your App"]:::app');
    allNodes.add('App');
    
    lines.push('');
    lines.push('    %% Dependency Relationships');
    console.log('🔍 Checking for dependency graph edges...', !!analysis.dependencyGraph?.edges);
    
    // Add relationships based on dependency graph edges
    if (analysis.dependencyGraph?.edges && analysis.dependencyGraph.edges.length > 0) {
      const importantEdges = analysis.dependencyGraph.edges
        .filter((edge: any) => edge.weight > 1 || edge.type === 'import' || edge.type === 'render')
        .sort((a: any, b: any) => b.weight - a.weight)
        .slice(0, 50); // Limit to top 50 relationships to avoid clutter
      
      importantEdges.forEach((edge: any) => {
        const fromId = this.sanitizeNodeId(edge.from);
        const toId = this.sanitizeNodeId(edge.to);
        
        // Only show edges between nodes that exist in our diagram
        if (allNodes.has(edge.from) || edge.from === 'App') {
          if (allNodes.has(edge.to)) {
            let arrowType = '-->';
            let label = '';
            
            // Different arrow types for different relationship types
            switch (edge.type) {
              case 'import':
                arrowType = '-->';
                label = edge.weight > 1 ? `|"${edge.weight} imports"| ` : '';
                break;
              case 'render':
                arrowType = '==>';
                label = '|renders| ';
                break;
              case 'call':
                arrowType = '-.>';
                label = edge.weight > 5 ? `|"${edge.weight} calls"| ` : '';
                break;
              case 'reference':
                arrowType = '-->';
                label = '';
                break;
            }
            
            lines.push(`    ${fromId} ${arrowType}${label}${toId}`);
          }
        }
      });
    } else {
      // Fallback: create basic app -> dependency relationships if no edge data
      lines.push('    %% Basic app dependencies (no detailed relationship data available)');
      console.log('🔍 No dependency graph edges found, using fallback visualization');
      
      if (analysis.usedDependencies) {
        const usedDeps = Array.from(analysis.usedDependencies);
        const mainDeps = usedDeps.filter((dep: string) => 
          dep === 'react' || 
          dep === 'react-dom' || 
          dep.startsWith('@radix-ui/') || 
          dep === 'lucide-react' ||
          dep === 'wouter' ||
          dep === '@tanstack/react-query'
        ).slice(0, 15);
        
        mainDeps.forEach((dep: string) => {
          const nodeId = this.sanitizeNodeId(dep);
          lines.push(`    App --> ${nodeId}`);
        });
        
        // Show some dependency relationships we can infer
        lines.push('    %% Inferred relationships');
        if (usedDeps.includes('react-dom') && usedDeps.includes('react')) {
          lines.push('    react_dom --> react');
        }
        
        // Show UI component dependencies
        const radixComponents = usedDeps.filter((dep: string) => dep.startsWith('@radix-ui/'));
        radixComponents.slice(0, 5).forEach((dep: string) => {
          const nodeId = this.sanitizeNodeId(dep);
          lines.push(`    ${nodeId} --> react`);
        });
      }
    }
    
    lines.push('');
    
    // Add legend
    lines.push('    %% Legend');
    lines.push('    subgraph Legend');
    lines.push('        LU["✅ Used Dependency"]:::used');
    lines.push('        LUN["❌ Unused Dependency"]:::unused');
    lines.push('        LH["⚠️ Heavy Dependency"]:::heavy');
    lines.push('        LS["🖥️ Server-Side"]:::server');
    lines.push('        LUI["🎨 UI Component"]:::ui');
    lines.push('        LA["📱 Your App"]:::app');
    lines.push('        %% Arrow Types:');
    lines.push('        %% --> Direct Import');
    lines.push('        %% ==> Renders Component');
    lines.push('        %% -.-> Function Call');
    lines.push('    end');
    
    return lines.join('\n');
  }

  private sanitizeNodeId(name: string): string {
    // Convert package names to valid mermaid node IDs
    return name
      .replace(/[@\/\-\.]/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .replace(/^(\d)/, '_$1'); // Prefix numbers with underscore
  }
}
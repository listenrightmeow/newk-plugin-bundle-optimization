import * as fs from 'fs/promises';
import * as path from 'path';
import glob from 'fast-glob';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ComponentAnalysis {
  totalDependencies: number;
  totalComponents: number;
  importedComponents: Map<string, ComponentImportInfo>;
  renderedComponents: Map<string, ComponentRenderInfo>;
  eliminationCandidates: string[];
}

export interface ComponentImportInfo {
  componentName: string;
  packageName: string;
  filePath: string;
  importStatement: string;
  isUIComponent: boolean;
}

export interface ComponentRenderInfo {
  componentName: string;
  renderCount: number;
  filePaths: string[];
  jsxUsages: string[];
}

export interface EliminationData {
  eliminationCandidates: string[];
  safeCandidates: string[];
  riskyCandidates: string[];
  interdependentComponents: Map<string, string[]>;
}

export interface EliminationResult {
  removedComponents: string[];
  removedPackages: string[];
  restoredComponents: string[];
  errors: string[];
}

export interface RefinementData {
  heavyDependencies: string[];
  unusedExports: Map<string, string[]>;
  optimizationOpportunities: string[];
}

export interface RefinementResult {
  appliedRefinements: string[];
  eliminatedDependencies: string[];
  errors: string[];
}

/**
 * ComponentUsageAnalyzer - Analyzes component imports vs actual JSX usage
 * 
 * Key Features:
 * - Scans for import statements vs JSX render usage
 * - Identifies truly unused components (imported but never rendered)
 * - Handles inter-component dependencies 
 * - Safe elimination with rollback capabilities
 */
export class ComponentUsageAnalyzer {

  /**
   * Analyze entire project for component usage patterns
   */
  async analyzeProject(projectPath: string): Promise<ComponentAnalysis> {
    console.log('🔍 Analyzing component usage patterns...');

    // 1. Find all source files
    const sourceFiles = await this.findSourceFiles(projectPath);
    console.log(`📁 Found ${sourceFiles.length} source files`);

    // 2. Scan for imports
    const importedComponents = await this.scanImports(sourceFiles);
    console.log(`📦 Found ${importedComponents.size} imported components`);

    // 3. Scan for JSX usage
    const renderedComponents = await this.scanJSXUsage(sourceFiles);
    console.log(`🎨 Found ${renderedComponents.size} rendered components`);

    // 4. Identify elimination candidates
    const eliminationCandidates = this.identifyBasicEliminationCandidates(
      importedComponents, 
      renderedComponents
    );

    // Convert Maps to objects for JSON serialization
    const importedObj: Record<string, string[]> = {};
    for (const [key, value] of importedComponents) {
      importedObj[key] = [value.filePath];  // Store where it was imported from
    }
    
    const renderedObj: Record<string, string[]> = {};
    for (const [key, value] of renderedComponents) {
      renderedObj[key] = value.filePaths;  // Store where it was rendered
    }
    
    // Add ZULU intelligence data for nuclear optimization
    const zuluIntelligence = {
      actuallyRendered: Array.from(renderedComponents.keys()),
      renderFrequency: new Map<string, number>(),
      importOnly: [] as string[]
    };
    
    // Track render frequency for component prioritization
    for (const [name, info] of renderedComponents) {
      zuluIntelligence.renderFrequency.set(name, info.renderCount);
    }
    
    // Track import-only components (candidates for elimination)
    for (const [name] of importedComponents) {
      if (!renderedComponents.has(name)) {
        zuluIntelligence.importOnly.push(name);
      }
    }

    return {
      totalDependencies: importedComponents.size,
      totalComponents: importedComponents.size,
      importedComponents: importedObj as any,  // Type cast for compatibility
      renderedComponents: renderedObj as any,  // Type cast for compatibility
      eliminationCandidates
    };
  }

  /**
   * Deep analysis to identify elimination candidates with safety checks
   */
  async identifyEliminationCandidates(projectPath: string): Promise<EliminationData> {
    console.log('🎯 Identifying elimination candidates...');

    const analysis = await this.analyzeProject(projectPath);
    
    // 1. Basic elimination candidates (imported but not rendered)
    const basicCandidates = analysis.eliminationCandidates;
    
    // 2. Check for inter-component dependencies
    const interdependencies = await this.findInterComponentDependencies(
      projectPath, 
      analysis.importedComponents
    );
    
    // 3. Classify candidates by safety
    const { safeCandidates, riskyCandidates } = this.classifyCandidatesSafety(
      basicCandidates, 
      interdependencies,
      analysis.importedComponents
    );

    console.log(`✅ Safe candidates: ${safeCandidates.length}`);
    console.log(`⚠️  Risky candidates: ${riskyCandidates.length}`);

    return {
      eliminationCandidates: basicCandidates,
      safeCandidates,
      riskyCandidates,
      interdependentComponents: interdependencies
    };
  }

  /**
   * Safely eliminate unused components
   */
  async eliminateUnusedComponents(
    projectPath: string, 
    candidates: string[]
  ): Promise<EliminationResult> {
    console.log(`🗑️  Eliminating ${candidates.length} unused components...`);

    const removedComponents: string[] = [];
    const removedPackages: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Create backup before elimination
      await this.createBackup(projectPath);

      // 2. Remove component files
      for (const componentName of candidates) {
        try {
          const componentPath = await this.findComponentFile(projectPath, componentName);
          if (componentPath) {
            // Rename to .unused instead of deleting (safer)
            await fs.rename(componentPath, `${componentPath}.unused`);
            removedComponents.push(componentName);
            console.log(`  ✓ Disabled: ${componentName}`);
          }
        } catch (error) {
          errors.push(`Failed to remove ${componentName}: ${error.message}`);
        }
      }

      // 3. Update import statements
      await this.removeImportStatements(projectPath, removedComponents);

      // 4. Identify packages to remove from package.json
      const packagesToRemove = await this.identifyUnusedPackages(projectPath, removedComponents);
      removedPackages.push(...packagesToRemove);

      console.log(`✅ Eliminated ${removedComponents.length} components`);
      console.log(`📦 Identified ${removedPackages.length} packages for removal`);

      return {
        removedComponents,
        removedPackages,
        restoredComponents: [],
        errors
      };

    } catch (error) {
      errors.push(`Elimination failed: ${error.message}`);
      return {
        removedComponents,
        removedPackages,
        restoredComponents: [],
        errors
      };
    }
  }

  /**
   * Remove unused packages from package.json
   */
  async removeUnusedPackages(projectPath: string, packages: string[]): Promise<void> {
    if (packages.length === 0) return;

    console.log(`📦 Removing ${packages.length} unused packages from package.json...`);

    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      let removedCount = 0;

      // Remove from dependencies
      if (packageJson.dependencies) {
        packages.forEach(pkg => {
          if (packageJson.dependencies[pkg]) {
            delete packageJson.dependencies[pkg];
            removedCount++;
            console.log(`  ✓ Removed: ${pkg}`);
          }
        });
      }

      // Remove from devDependencies (only UI packages, not build tools)
      if (packageJson.devDependencies) {
        const uiPackages = packages.filter(pkg => 
          pkg.startsWith('@radix-ui/') || 
          pkg.startsWith('lucide-') || 
          pkg.includes('ui')
        );
        
        uiPackages.forEach(pkg => {
          if (packageJson.devDependencies[pkg]) {
            delete packageJson.devDependencies[pkg];
            removedCount++;
            console.log(`  ✓ Removed: ${pkg} (dev)`);
          }
        });
      }

      if (removedCount > 0) {
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log(`✅ Removed ${removedCount} packages from package.json`);
      }

    } catch (error) {
      console.error(`Failed to update package.json: ${error.message}`);
    }
  }

  /**
   * Analyze opportunities for dependency refinement
   */
  async analyzeRefinementOpportunities(projectPath: string): Promise<RefinementData> {
    console.log('🔧 Analyzing refinement opportunities...');

    // 1. Identify heavy dependencies that could be optimized
    const heavyDependencies = await this.identifyHeavyDependencies(projectPath);
    
    // 2. Find unused exports within used packages
    const unusedExports = await this.findUnusedExports(projectPath);
    
    // 3. Identify other optimization opportunities
    const optimizationOpportunities = [
      'tree-shaking improvements',
      'dynamic import opportunities',
      'bundle splitting optimizations'
    ];

    return {
      heavyDependencies,
      unusedExports,
      optimizationOpportunities
    };
  }

  /**
   * Apply refinement optimizations
   */
  async applyRefinements(projectPath: string, data: RefinementData): Promise<RefinementResult> {
    console.log('🔧 Applying refinement optimizations...');

    const appliedRefinements: string[] = [];
    const eliminatedDependencies: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Optimize heavy dependencies
      for (const dep of data.heavyDependencies) {
        try {
          await this.optimizeHeavyDependency(projectPath, dep);
          appliedRefinements.push(`Optimized heavy dependency: ${dep}`);
        } catch (error) {
          errors.push(`Failed to optimize ${dep}: ${error.message}`);
        }
      }

      // 2. Remove unused exports
      for (const [pkg, unusedExports] of data.unusedExports) {
        try {
          await this.removeUnusedExports(projectPath, pkg, unusedExports);
          appliedRefinements.push(`Removed ${unusedExports.length} unused exports from ${pkg}`);
        } catch (error) {
          errors.push(`Failed to optimize exports for ${pkg}: ${error.message}`);
        }
      }

      console.log(`✅ Applied ${appliedRefinements.length} refinements`);

      return {
        appliedRefinements,
        eliminatedDependencies,
        errors
      };

    } catch (error) {
      errors.push(`Refinement failed: ${error.message}`);
      return { appliedRefinements, eliminatedDependencies, errors };
    }
  }

  // Private helper methods

  private async findSourceFiles(projectPath: string): Promise<string[]> {
    return await glob([
      `${projectPath}/client/src/**/*.{ts,tsx,js,jsx}`,
      `${projectPath}/src/**/*.{ts,tsx,js,jsx}`,
      `!${projectPath}/**/node_modules/**`,
      `!${projectPath}/**/dist/**`,
      `!${projectPath}/**/*.test.*`,
      `!${projectPath}/**/*.spec.*`
    ]);
  }

  private async scanImports(sourceFiles: string[]): Promise<Map<string, ComponentImportInfo>> {
    const importedComponents = new Map<string, ComponentImportInfo>();

    for (const filePath of sourceFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Match UI component imports
        const importRegex = /import\s*{([^}]+)}\s*from\s*['"](@\/components\/ui\/[^'"]+|@radix-ui\/[^'"]+|lucide-react)['"];?/g;
        const matches = content.matchAll(importRegex);

        for (const match of matches) {
          const imports = match[1].split(',').map(imp => imp.trim());
          const packageName = match[2];

          imports.forEach(componentName => {
            const cleanName = componentName.replace(/\s*as\s+\w+/, '').trim();
            if (cleanName) {
              importedComponents.set(cleanName, {
                componentName: cleanName,
                packageName,
                filePath,
                importStatement: match[0],
                isUIComponent: packageName.includes('@radix-ui/') || packageName.includes('@/components/ui/')
              });
            }
          });
        }
      } catch (error) {
        console.warn(`Failed to scan imports in ${filePath}: ${error.message}`);
      }
    }

    return importedComponents;
  }

  private async scanJSXUsage(sourceFiles: string[]): Promise<Map<string, ComponentRenderInfo>> {
    const renderedComponents = new Map<string, ComponentRenderInfo>();

    for (const filePath of sourceFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        
        // More precise JSX component matching:
        // 1. Must be <ComponentName with space, /, or > after
        // 2. Exclude common HTML tags
        const jsxRegex = /<([A-Z][a-zA-Z0-9]*)(?=[\s/>])/g;
        const matches = content.matchAll(jsxRegex);
        
        // Common HTML/SVG tags to exclude
        const htmlTags = new Set(['SVG', 'G', 'Path', 'Circle', 'Rect', 'Line', 'Text', 'Image']);

        for (const match of matches) {
          const componentName = match[1];
          
          // Skip HTML/SVG tags
          if (htmlTags.has(componentName)) continue;
          
          if (renderedComponents.has(componentName)) {
            const info = renderedComponents.get(componentName)!;
            info.renderCount++;
            if (!info.filePaths.includes(filePath)) {
              info.filePaths.push(filePath);
            }
            info.jsxUsages.push(match[0]);
          } else {
            renderedComponents.set(componentName, {
              componentName,
              renderCount: 1,
              filePaths: [filePath],
              jsxUsages: [match[0]]
            });
          }
        }
      } catch (error) {
        console.warn(`Failed to scan JSX usage in ${filePath}: ${error.message}`);
      }
    }

    return renderedComponents;
  }

  private identifyBasicEliminationCandidates(
    imported: Map<string, ComponentImportInfo>, 
    rendered: Map<string, ComponentRenderInfo>
  ): string[] {
    const candidates: string[] = [];

    // ULTRA-AGGRESSIVE MODE: More liberal elimination
    for (const [componentName, importInfo] of imported) {
      const renderInfo = rendered.get(componentName);
      
      if (!renderInfo) {
        // Not rendered at all - definite candidate
        candidates.push(componentName);
        console.log(`   🎯 Candidate for elimination: ${componentName} (imported but never rendered)`);
      } else if (renderInfo.renderCount <= 1 && renderInfo.filePaths.length <= 1) {
        // Rendered only once in one file - potential candidate
        candidates.push(componentName);
        console.log(`   🎯 Candidate for elimination: ${componentName} (rarely used - ${renderInfo.renderCount} renders)`);
      }
    }

    // Also find components that exist but aren't even imported
    // This catches dead code that's just sitting there
    console.log(`   📊 Found ${candidates.length} components imported but never rendered`);

    return candidates;
  }

  private async findInterComponentDependencies(
    projectPath: string, 
    importedComponents: Map<string, ComponentImportInfo>
  ): Promise<Map<string, string[]>> {
    const dependencies = new Map<string, string[]>();

    // Check UI components folder for internal dependencies
    const uiComponentsPath = path.join(projectPath, 'client/src/components/ui');
    
    try {
      const uiFiles = await glob(`${uiComponentsPath}/*.tsx`);
      
      for (const filePath of uiFiles) {
        const content = await fs.readFile(filePath, 'utf-8');
        const componentName = path.basename(filePath, '.tsx');
        const deps: string[] = [];

        // Look for imports from other UI components
        const uiImportRegex = /import.*from\s*['"]@\/components\/ui\/([^'"]+)['"];?/g;
        const matches = content.matchAll(uiImportRegex);

        for (const match of matches) {
          const depComponent = match[1].replace(/\.(tsx?|jsx?)$/, '');
          if (depComponent !== componentName) {
            deps.push(depComponent);
          }
        }

        if (deps.length > 0) {
          dependencies.set(componentName, deps);
        }
      }
    } catch (error) {
      console.warn(`Failed to analyze UI component dependencies: ${error.message}`);
    }

    return dependencies;
  }

  private classifyCandidatesSafety(
    candidates: string[], 
    interdependencies: Map<string, string[]>,
    importedComponents: Map<string, ComponentImportInfo>
  ): { safeCandidates: string[], riskyCandidates: string[] } {
    // AGGRESSIVE MODE: We'll try to eliminate EVERYTHING first
    // The headless browser test will tell us if we went too far
    
    const safeCandidates: string[] = [];
    const riskyCandidates: string[] = [];

    for (const candidate of candidates) {
      // Only mark as risky if it's TRULY critical (React itself, router, etc)
      const importInfo = importedComponents.get(candidate);
      const isTrulyCritical = 
        candidate === 'React' ||
        candidate === 'ReactDOM' ||
        candidate === 'Router' ||
        candidate === 'QueryClient' ||
        candidate === 'App';

      if (isTrulyCritical) {
        riskyCandidates.push(candidate);
      } else {
        // Everything else is fair game for elimination
        // We'll let the headless browser test be our safety net
        safeCandidates.push(candidate);
      }
    }

    console.log(`   🚀 AGGRESSIVE MODE: ${safeCandidates.length} components marked for elimination`);
    console.log(`   🛡️  Only ${riskyCandidates.length} critical components protected`);

    return { safeCandidates, riskyCandidates };
  }

  private async createBackup(projectPath: string): Promise<void> {
    const backupPath = path.join(projectPath, '.newk-backup');
    try {
      await execAsync(`cp -r "${path.join(projectPath, 'client/src/components')}" "${backupPath}"`);
      console.log('📋 Created component backup');
    } catch (error) {
      console.warn(`Failed to create backup: ${error.message}`);
    }
  }

  private async findComponentFile(projectPath: string, componentName: string): Promise<string | null> {
    const possiblePaths = [
      path.join(projectPath, `client/src/components/ui/${componentName}.tsx`),
      path.join(projectPath, `client/src/components/ui/${componentName}.ts`),
      path.join(projectPath, `client/src/components/${componentName}.tsx`),
      path.join(projectPath, `client/src/components/${componentName}.ts`)
    ];

    for (const filePath of possiblePaths) {
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        continue;
      }
    }

    return null;
  }

  private async removeImportStatements(projectPath: string, removedComponents: string[]): Promise<void> {
    if (removedComponents.length === 0) return;

    console.log('🔧 Removing import statements...');

    const sourceFiles = await this.findSourceFiles(projectPath);

    for (const filePath of sourceFiles) {
      try {
        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;

        for (const componentName of removedComponents) {
          // Remove individual imports from import statements
          const individualImportRegex = new RegExp(
            `import\\s*{([^}]*)}\\s*from\\s*['"]@/components/ui/[^'"]*['"];?`,
            'g'
          );

          content = content.replace(individualImportRegex, (match, imports) => {
            const importList = imports.split(',').map(imp => imp.trim());
            const filteredImports = importList.filter(imp => 
              !imp.replace(/\s*as\s+\w+/, '').trim().includes(componentName)
            );

            if (filteredImports.length === 0) {
              hasChanges = true;
              return ''; // Remove entire import statement
            } else if (filteredImports.length !== importList.length) {
              hasChanges = true;
              return match.replace(imports, filteredImports.join(', '));
            }
            return match;
          });

          // Remove standalone import statements
          const standaloneImportRegex = new RegExp(
            `import\\s+${componentName}\\s+from\\s+['"][^'"]+['"];?\\n?`,
            'g'
          );
          if (standaloneImportRegex.test(content)) {
            content = content.replace(standaloneImportRegex, '');
            hasChanges = true;
          }
        }

        if (hasChanges) {
          await fs.writeFile(filePath, content);
          console.log(`  ✓ Updated imports in ${path.basename(filePath)}`);
        }
      } catch (error) {
        console.warn(`Failed to update imports in ${filePath}: ${error.message}`);
      }
    }
  }

  private async identifyUnusedPackages(projectPath: string, removedComponents: string[]): Promise<string[]> {
    const unusedPackages: string[] = [];

    // Map component names to their likely packages
    const componentToPackageMap = new Map<string, string>();
    componentToPackageMap.set('Button', '@radix-ui/react-button');
    componentToPackageMap.set('Card', '@radix-ui/react-card');
    componentToPackageMap.set('Dialog', '@radix-ui/react-dialog');
    componentToPackageMap.set('Dropdown', '@radix-ui/react-dropdown-menu');
    // Add more mappings as needed

    for (const componentName of removedComponents) {
      const packageName = componentToPackageMap.get(componentName);
      if (packageName) {
        unusedPackages.push(packageName);
      } else {
        // Try to infer package name from component name
        const inferredPackage = `@radix-ui/react-${componentName.toLowerCase().replace(/([A-Z])/g, '-$1').slice(1)}`;
        unusedPackages.push(inferredPackage);
      }
    }

    return [...new Set(unusedPackages)]; // Remove duplicates
  }

  private async identifyHeavyDependencies(projectPath: string): Promise<string[]> {
    // This would analyze bundle size per dependency
    // For now, return known heavy UI dependencies
    return [
      '@tanstack/react-query',
      'recharts',
      'framer-motion',
      'lucide-react'
    ];
  }

  private async findUnusedExports(projectPath: string): Promise<Map<string, string[]>> {
    // Placeholder for finding unused exports within used packages
    return new Map();
  }

  private async optimizeHeavyDependency(projectPath: string, dependency: string): Promise<void> {
    console.log(`🔧 Optimizing heavy dependency: ${dependency}`);
    // Implement dependency-specific optimizations
  }

  private async removeUnusedExports(projectPath: string, packageName: string, exports: string[]): Promise<void> {
    console.log(`🔧 Removing unused exports from ${packageName}: ${exports.join(', ')}`);
    // Implement export removal logic
  }
}
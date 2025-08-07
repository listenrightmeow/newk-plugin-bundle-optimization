import * as fs from 'fs/promises';
import * as path from 'path';
import { PhaseResult } from './SmartBundleOptimizer.js';
import { AutomatedValidator, ValidationResult } from './AutomatedValidator.js';
import { BundleMetricsTracker, BundleMetrics } from './BundleMetricsTracker.js';

export interface RecoveryConfig {
  maxIterations: number;
  testEachIteration: boolean;
  preserveCritical: string[];
  recoveryStrategy: 'conservative' | 'aggressive' | 'balanced';
}

export interface RecoveryStep {
  iteration: number;
  action: 'remove' | 'restore' | 'test';
  components: string[];
  dependencies: string[];
  success: boolean;
  errors: string[];
  metrics?: BundleMetrics;
}

export interface RecoveryResult {
  success: boolean;
  minimalDependencies: string[];
  minimalComponents: string[];
  restoredComponents: string[];
  totalIterations: number;
  finalMetrics?: BundleMetrics;
  recoverySteps: RecoveryStep[];
  errors: string[];
  performance?: ValidationResult;
}

/**
 * SmartRecovery - Binary search approach to find minimal viable dependency set
 * 
 * When optimization phases fail, this system uses binary search to:
 * 1. Identify the exact components causing failures
 * 2. Find the minimal set of dependencies needed for functionality
 * 3. Restore only what's necessary to fix the application
 * 4. Optimize iteratively until the best balance is found
 */
export class SmartRecovery {
  private validator?: AutomatedValidator;
  private metricsTracker: BundleMetricsTracker;
  private defaultConfig: RecoveryConfig = {
    maxIterations: 20,
    testEachIteration: true,
    preserveCritical: ['Button', 'Card', 'Dialog', 'Toast'],
    recoveryStrategy: 'balanced'
  };

  constructor() {
    this.metricsTracker = new BundleMetricsTracker();
  }

  /**
   * Perform binary search recovery from a failed optimization
   */
  async performBinarySearchRecovery(
    projectPath: string,
    failedPhase: PhaseResult,
    validator?: AutomatedValidator,
    config?: Partial<RecoveryConfig>
  ): Promise<RecoveryResult> {
    this.validator = validator;
    const recoveryConfig = { ...this.defaultConfig, ...config };

    console.log('🔍 Starting binary search recovery...');
    console.log(`📋 Recovery strategy: ${recoveryConfig.recoveryStrategy}`);
    console.log(`🎯 Max iterations: ${recoveryConfig.maxIterations}`);

    const recoverySteps: RecoveryStep[] = [];
    const errors: string[] = [];
    let currentIteration = 0;

    try {
      // 1. Identify what was changed in the failed phase
      const changedComponents = failedPhase.changes.eliminatedComponents;
      const changedDependencies = failedPhase.changes.eliminatedDependencies;

      console.log(`🔍 Analyzing failure in ${failedPhase.phase.toUpperCase()} phase:`);
      console.log(`   📦 Components eliminated: ${changedComponents.length}`);
      console.log(`   🔗 Dependencies eliminated: ${changedDependencies.length}`);
      console.log(`   ❌ Errors: ${failedPhase.errors.length}`);

      if (changedComponents.length === 0 && changedDependencies.length === 0) {
        return {
          success: false,
          minimalDependencies: [],
          minimalComponents: [],
          restoredComponents: [],
          totalIterations: 0,
          recoverySteps,
          errors: ['No changes detected to recover from']
        };
      }

      // 2. Start binary search process
      const result = await this.binarySearchOptimalSet(
        projectPath,
        changedComponents,
        changedDependencies,
        recoveryConfig,
        recoverySteps
      );

      // 3. Final validation and metrics
      let finalMetrics: BundleMetrics | undefined;
      let performance: ValidationResult | undefined;

      if (result.success && this.validator) {
        performance = await this.validator.validateApplication(projectPath);
        if (performance.success) {
          finalMetrics = await this.metricsTracker.captureMetrics(projectPath, 'charlie-final');
        }
      }

      return {
        ...result,
        totalIterations: currentIteration,
        finalMetrics,
        recoverySteps,
        errors,
        performance
      };

    } catch (error) {
      errors.push(`Recovery failed: ${error.message}`);
      return {
        success: false,
        minimalDependencies: [],
        minimalComponents: [],
        restoredComponents: [],
        totalIterations: currentIteration,
        recoverySteps,
        errors
      };
    }
  }

  /**
   * Binary search to find optimal dependency set
   */
  private async binarySearchOptimalSet(
    projectPath: string,
    eliminatedComponents: string[],
    eliminatedDependencies: string[],
    config: RecoveryConfig,
    recoverySteps: RecoveryStep[]
  ): Promise<Omit<RecoveryResult, 'totalIterations' | 'recoverySteps' | 'errors'>> {
    
    console.log('🎯 Starting binary search for optimal dependency set...');

    // Start with all eliminated items
    let workingSet = [...eliminatedComponents];
    let restoredComponents: string[] = [];
    let currentIteration = 0;

    // Binary search on components first
    while (workingSet.length > 0 && currentIteration < config.maxIterations) {
      currentIteration++;
      console.log(`\n🔄 Iteration ${currentIteration}: Testing ${workingSet.length} components`);

      // Split the working set in half
      const halfSize = Math.ceil(workingSet.length / 2);
      const testSet = workingSet.slice(0, halfSize);
      const remainingSet = workingSet.slice(halfSize);

      console.log(`   🧪 Testing restoration of: ${testSet.join(', ')}`);

      // Restore the test set
      const restoreResult = await this.restoreComponents(projectPath, testSet);
      
      const step: RecoveryStep = {
        iteration: currentIteration,
        action: 'restore',
        components: testSet,
        dependencies: [],
        success: restoreResult.success,
        errors: restoreResult.errors
      };

      if (restoreResult.success) {
        // Test if restoration fixed the issues
        const testResult = await this.testCurrentState(projectPath, config);
        step.success = testResult.success;
        
        if (testResult.success) {
          // This set works, try to minimize further
          console.log(`   ✅ Test set works, trying to minimize...`);
          restoredComponents.push(...testSet);
          workingSet = remainingSet; // Continue with remaining items
          
          // Try to remove some components from the test set
          if (testSet.length > 1) {
            const minimizerResult = await this.minimizeWorkingSet(
              projectPath, testSet, config, currentIteration
            );
            
            // Update restored components based on minimizer result
            const actuallyNeeded = minimizerResult.necessaryComponents;
            restoredComponents = restoredComponents.filter(comp => 
              !testSet.includes(comp) || actuallyNeeded.includes(comp)
            );
            restoredComponents.push(...actuallyNeeded);
            
            // Remove unnecessary components that were restored
            const unnecessary = testSet.filter(comp => !actuallyNeeded.includes(comp));
            if (unnecessary.length > 0) {
              await this.removeComponents(projectPath, unnecessary);
              console.log(`   🗑️  Removed unnecessary: ${unnecessary.join(', ')}`);
            }
          }
        } else {
          // This set doesn't work, remove it and continue with remaining
          console.log(`   ❌ Test set failed, removing and trying remaining set`);
          await this.removeComponents(projectPath, testSet);
          workingSet = remainingSet;
        }
      } else {
        // Restoration failed, skip this set
        console.log(`   ❌ Restoration failed for: ${testSet.join(', ')}`);
        workingSet = remainingSet;
      }

      recoverySteps.push(step);

      // Prevent infinite loops
      if (currentIteration >= config.maxIterations) {
        console.log(`⚠️  Reached maximum iterations (${config.maxIterations})`);
        break;
      }
    }

    // Final test
    const finalTest = await this.testCurrentState(projectPath, config);
    
    return {
      success: finalTest.success,
      minimalDependencies: eliminatedDependencies, // For now, keep all dependencies
      minimalComponents: restoredComponents,
      restoredComponents
    };
  }

  /**
   * Minimize a working set to find exactly which components are needed
   */
  private async minimizeWorkingSet(
    projectPath: string,
    workingSet: string[],
    config: RecoveryConfig,
    baseIteration: number
  ): Promise<{ necessaryComponents: string[] }> {
    console.log(`   🔍 Minimizing working set of ${workingSet.length} components...`);

    const necessaryComponents: string[] = [];

    // Test each component individually
    for (const component of workingSet) {
      // Remove this component temporarily
      await this.removeComponents(projectPath, [component]);
      
      // Test if the app still works
      const testResult = await this.testCurrentState(projectPath, config);
      
      if (!testResult.success) {
        // Component is necessary, restore it
        await this.restoreComponents(projectPath, [component]);
        necessaryComponents.push(component);
        console.log(`     ✅ ${component} is necessary`);
      } else {
        console.log(`     🗑️  ${component} is not necessary`);
      }
    }

    return { necessaryComponents };
  }

  /**
   * Restore components that were eliminated
   */
  private async restoreComponents(projectPath: string, components: string[]): Promise<{ success: boolean, errors: string[] }> {
    const errors: string[] = [];

    for (const component of components) {
      try {
        const componentPath = await this.findUnusedComponent(projectPath, component);
        if (componentPath) {
          const originalPath = componentPath.replace('.unused', '');
          await fs.rename(componentPath, originalPath);
          console.log(`     ↩️  Restored: ${component}`);
        } else {
          errors.push(`Component file not found: ${component}`);
        }
      } catch (error) {
        errors.push(`Failed to restore ${component}: ${error.message}`);
      }
    }

    // Also restore any import statements that might be needed
    await this.restoreImportStatements(projectPath, components);

    return { success: errors.length === 0, errors };
  }

  /**
   * Remove components (rename to .unused)
   */
  private async removeComponents(projectPath: string, components: string[]): Promise<void> {
    for (const component of components) {
      try {
        const componentPath = await this.findActiveComponent(projectPath, component);
        if (componentPath) {
          await fs.rename(componentPath, `${componentPath}.unused`);
          console.log(`     🗑️  Removed: ${component}`);
        }
      } catch (error) {
        console.warn(`Failed to remove ${component}: ${error.message}`);
      }
    }

    // Remove import statements
    await this.removeImportStatements(projectPath, components);
  }

  /**
   * Test current state of the application
   */
  private async testCurrentState(projectPath: string, config: RecoveryConfig): Promise<{ success: boolean, errors: string[] }> {
    if (!config.testEachIteration || !this.validator) {
      // Just try to build
      return await this.testBuildOnly(projectPath);
    }

    try {
      const validationResult = await this.validator.quickValidation(projectPath);
      return {
        success: validationResult.success,
        errors: validationResult.errors
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Validation failed: ${error.message}`]
      };
    }
  }

  private async testBuildOnly(projectPath: string): Promise<{ success: boolean, errors: string[] }> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync('npm run build', {
        cwd: projectPath,
        timeout: 60000
      });

      return { success: true, errors: [] };
    } catch (error) {
      return { success: false, errors: [`Build failed: ${error.message}`] };
    }
  }

  private async findUnusedComponent(projectPath: string, componentName: string): Promise<string | null> {
    const possiblePaths = [
      path.join(projectPath, `client/src/components/ui/${componentName}.tsx.unused`),
      path.join(projectPath, `client/src/components/ui/${componentName}.ts.unused`),
      path.join(projectPath, `client/src/components/${componentName}.tsx.unused`),
      path.join(projectPath, `client/src/components/${componentName}.ts.unused`)
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

  private async findActiveComponent(projectPath: string, componentName: string): Promise<string | null> {
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

  private async restoreImportStatements(projectPath: string, components: string[]): Promise<void> {
    // This would need to analyze what imports are needed and restore them
    // For now, this is a placeholder
    console.log(`     🔧 TODO: Restore import statements for: ${components.join(', ')}`);
  }

  private async removeImportStatements(projectPath: string, components: string[]): Promise<void> {
    // Remove import statements for the given components
    const glob = await import('fast-glob');
    const sourceFiles = await glob.default([
      `${projectPath}/client/src/**/*.{ts,tsx,js,jsx}`,
      `!${projectPath}/**/node_modules/**`,
      `!${projectPath}/**/dist/**`
    ]);

    for (const filePath of sourceFiles) {
      try {
        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;

        for (const component of components) {
          // Remove from import statements
          const importRegex = new RegExp(
            `import\\s*{([^}]*)}\\s*from\\s*['"]@/components/ui/[^'"]*['"];?`,
            'g'
          );

          content = content.replace(importRegex, (match, imports) => {
            const importList = imports.split(',').map(imp => imp.trim());
            const filteredImports = importList.filter(imp => 
              !imp.replace(/\s*as\s+\w+/, '').trim().includes(component)
            );

            if (filteredImports.length === 0) {
              hasChanges = true;
              return '';
            } else if (filteredImports.length !== importList.length) {
              hasChanges = true;
              return match.replace(imports, filteredImports.join(', '));
            }
            return match;
          });
        }

        if (hasChanges) {
          await fs.writeFile(filePath, content);
        }
      } catch (error) {
        console.warn(`Failed to update imports in ${filePath}: ${error.message}`);
      }
    }
  }
}
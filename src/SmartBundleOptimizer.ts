import * as fs from 'fs/promises';
import * as path from 'path';
import { ComponentUsageAnalyzer } from './ComponentUsageAnalyzer.js';
import { BundleMetricsTracker } from './BundleMetricsTracker.js';
import { AutomatedValidator } from './AutomatedValidator.js';
import { SmartRecovery } from './SmartRecovery.js';
// import { PerformanceMetricsCollector } from './PerformanceMetricsCollector.js';
import { NuclearOptimizer } from './NuclearOptimizer.js';

export type OptimizationMode = 'smart' | 'aggressive' | 'recovery' | 'nuclear';
export type OptimizationPhase = 'zulu' | 'alpha' | 'beta' | 'charlie';

export interface SmartOptimizationConfig {
  mode: OptimizationMode;
  phases: OptimizationPhase[];
  autoTest: boolean;
  visualize: boolean;
  compare: boolean;
  lastKnownGood?: OptimizationPhase;
}

export interface PhaseResult {
  phase: OptimizationPhase;
  success: boolean;
  metrics: {
    bundleSize: string;
    dependencyCount: number;
    componentCount: number;
    buildTime: number;
  };
  changes: {
    eliminatedComponents: string[];
    eliminatedDependencies: string[];
    restoredComponents: string[];
  };
  errors: string[];
  performance: {
    loadTime?: number;
    jsErrors?: string[];
    routesValidated?: string[];
  };
}

export interface SmartOptimizationResult {
  success: boolean;
  phases: PhaseResult[];
  totalReduction: {
    bundleSize: string;
    percentageReduction: number;
    dependencyReduction: number;
    componentReduction: number;
  };
  recommendations: string[];
  reportPath: string;
}

/**
 * Multi-Phase Progressive Optimization (MPPO) Controller
 * 
 * Orchestrates a four-phase optimization pipeline that systematically
 * reduces bundle size through intelligent analysis and reconstruction.
 * 
 * Phase Architecture:
 * - Baseline Analysis Phase (BAP): Metrics collection and graph construction
 * - Dead Code Elimination Phase (DCE): AST-based component removal
 * - Dependency Optimization Phase (DOP): Tree-shaking and code splitting
 * - Binary Recovery Phase (BRP): Intelligent restoration of essential code
 * 
 * @class SmartBundleOptimizer
 * @implements {OptimizationController}
 */
export class SmartBundleOptimizer {
  private componentAnalyzer: ComponentUsageAnalyzer;
  private metricsTracker: BundleMetricsTracker;
  private validator: AutomatedValidator;
  private recovery: SmartRecovery;
  // private performanceCollector: PerformanceMetricsCollector;
  private nuclearOptimizer: NuclearOptimizer;

  constructor() {
    this.componentAnalyzer = new ComponentUsageAnalyzer();
    this.metricsTracker = new BundleMetricsTracker();
    this.validator = new AutomatedValidator();
    this.recovery = new SmartRecovery();
    // this.performanceCollector = new PerformanceMetricsCollector();
    this.nuclearOptimizer = new NuclearOptimizer();
  }

  /**
   * Execute Multi-Phase Progressive Optimization pipeline
   * 
   * @param {string} projectPath - Target project directory
   * @param {SmartOptimizationConfig} config - Optimization parameters
   * @returns {Promise<SmartOptimizationResult>} Complete optimization metrics
   * @complexity O(n * m) where n = files, m = average file size
   */
  async optimize(
    projectPath: string, 
    config: SmartOptimizationConfig
  ): Promise<SmartOptimizationResult> {
    console.log(`🚀 Starting Smart Bundle Optimization (${config.mode} mode)`);
    console.log(`📋 Phases: ${config.phases.join(' → ')}`);
    
    const results: PhaseResult[] = [];
    let currentState = projectPath;

    try {
      // Execute phases in sequence
      for (const phase of config.phases) {
        console.log(`\n🔄 Phase ${phase.toUpperCase()}: Starting...`);
        
        // Start performance tracking for this phase
        // this.performanceCollector.startPhase(phase);
        
        let phaseResult: PhaseResult;
        
        try {
          switch (phase) {
            case 'zulu':
              phaseResult = await this.executeZuluPhase(currentState, config);
              break;
            case 'alpha':
              phaseResult = await this.executeAlphaPhase(currentState, config, results);
              break;
            case 'beta':
              phaseResult = await this.executeBetaPhase(currentState, config, results);
              break;
            case 'charlie':
              phaseResult = await this.executeCharliePhase(currentState, config, results);
              break;
            default:
              throw new Error(`Unknown optimization phase: ${phase}`);
          }
        } finally {
          // End performance tracking for this phase
          // const phaseMetrics = this.performanceCollector.endPhase();
          const phaseMetrics = null;
          if (phaseMetrics && phaseResult) {
            // Attach performance metrics to phase result
            (phaseResult as any).performanceMetrics = phaseMetrics;
          }
        }

        results.push(phaseResult);
        
        // If ALPHA broke the app, automatically add CHARLIE recovery phase
        if (phase === 'alpha' && !phaseResult.success && !config.phases.includes('charlie')) {
          console.log(`🔄 ALPHA phase broke the app - automatically adding CHARLIE recovery phase`);
          config.phases.push('charlie');
          // Continue to next phase (skip BETA, go straight to CHARLIE)
          continue;
        }
        
        // Skip BETA if ALPHA failed
        if (phase === 'beta' && results.some(r => r.phase === 'alpha' && !r.success)) {
          console.log(`⏭️  Skipping BETA phase - ALPHA failed, moving to recovery`);
          continue;
        }
        
        // Stop if phase failed and we're not in recovery mode
        if (!phaseResult.success && config.mode !== 'recovery' && phase !== 'alpha') {
          console.log(`❌ Phase ${phase.toUpperCase()} failed. Stopping optimization.`);
          break;
        }
        
        console.log(`✅ Phase ${phase.toUpperCase()}: ${phaseResult.success ? 'Success' : 'Failed'}`);
      }

      // Generate performance report
      // const performanceReport = await this.performanceCollector.generateReport(projectPath);
      const performanceReport = { totalDuration: 0 };
      console.log(`\n⚡ Total optimization time: ${(performanceReport.totalDuration / 1000).toFixed(2)}s`);
      
      // Generate final results with performance data
      const finalReport = await this.generateFinalReport(projectPath, results, config);
      
      // Add performance report to final results
      (finalReport as any).performanceReport = performanceReport;
      
      return finalReport;
      
    } catch (error) {
      console.error('🚨 Smart optimization failed:', error);
      
      // Still try to generate performance report even on failure
      try {
        // await this.performanceCollector.generateReport(projectPath);
      } catch {}
      
      return {
        success: false,
        phases: results,
        totalReduction: {
          bundleSize: '0 KB',
          percentageReduction: 0,
          dependencyReduction: 0,
          componentReduction: 0
        },
        recommendations: [`Optimization failed: ${error.message}`],
        reportPath: ''
      };
    }
  }

  /**
   * Baseline Analysis Phase (BAP): Establish comprehensive metrics
   * 
   * @private
   * @param {string} projectPath - Project directory
   * @param {SmartOptimizationConfig} config - Configuration
   * @returns {Promise<PhaseResult>} Phase execution results
   */
  private async executeZuluPhase(
    projectPath: string, 
    config: SmartOptimizationConfig
  ): Promise<PhaseResult> {
    console.log('📊 ZULU: Capturing baseline metrics...');
    
    const startTime = Date.now();
    
    // 1. Build current state and capture metrics
    const buildMetrics = await this.metricsTracker.captureBaseline(projectPath);
    
    // Track build performance
    // this.performanceCollector.addBuildMetrics(
    //   buildMetrics.buildTime,
    //   buildMetrics.totalSizeKB * 1024,
    //   buildMetrics.chunkCount
    // );
    
    // 2. Analyze current component usage
    const componentAnalysis = await this.componentAnalyzer.analyzeProject(projectPath);
    
    // 3. Run validation tests if enabled
    let performance: PhaseResult['performance'] = {};
    if (config.autoTest) {
      performance = await this.validator.validateApplication(projectPath);
    }

    // 4. Save baseline data
    const baselineData = {
      timestamp: new Date().toISOString(),
      buildMetrics,
      componentAnalysis,
      performance
    };
    
    const baselinePath = path.join(projectPath, 'zulu-baseline.json');
    await fs.writeFile(baselinePath, JSON.stringify(baselineData, null, 2));
    
    // Also save metrics for benchmark comparison
    await this.metricsTracker.storeZuluBaseline(projectPath, buildMetrics);

    const buildTime = Date.now() - startTime;

    return {
      phase: 'zulu',
      success: true,
      metrics: {
        bundleSize: buildMetrics.totalSize,
        dependencyCount: componentAnalysis.totalDependencies,
        componentCount: componentAnalysis.totalComponents,
        buildTime
      },
      changes: {
        eliminatedComponents: [],
        eliminatedDependencies: [],
        restoredComponents: []
      },
      errors: [],
      performance
    };
  }

  /**
   * ALPHA Phase: Eliminate unused components
   */
  private async executeAlphaPhase(
    projectPath: string, 
    config: SmartOptimizationConfig,
    previousPhases: PhaseResult[]
  ): Promise<PhaseResult> {
    const startTime = Date.now();
    const zuluResult = previousPhases.find(p => p.phase === 'zulu');
    
    if (!zuluResult) {
      throw new Error('ALPHA phase requires ZULU baseline');
    }

    // NUCLEAR MODE - Complete destruction and rebuild
    if (config.mode === 'nuclear') {
      console.log('☢️  ALPHA NUCLEAR MODE: Complete destruction and rebuild...');
      
      // Load ZULU data to know what's actually rendered
      let zuluData = null;
      try {
        const zuluPath = path.join(projectPath, 'zulu-baseline.json');
        const zuluContent = await fs.readFile(zuluPath, 'utf-8');
        zuluData = JSON.parse(zuluContent);
        console.log('📊 Loaded ZULU baseline for intelligent rebuilding');
      } catch (error) {
        console.log('⚠️  No ZULU data found - will recreate all components');
      }
      
      try {
        const nuclearResult = await this.nuclearOptimizer.executeNuclearOptimization(projectPath, {
          mode: 'scorched-earth',
          preserveList: ['App', 'main', 'index'],
          testCommand: 'npm run build',
          maxIterations: 50,
          rebuildStrategy: 'mangle',
          zuluData
        });
        
        // Capture metrics after nuclear optimization
        const postBuildMetrics = await this.metricsTracker.captureMetrics(projectPath, 'alpha-nuclear');
        
        return {
          phase: 'alpha',
          success: nuclearResult.success,
          metrics: {
            bundleSize: postBuildMetrics.totalSize,
            dependencyCount: 0,
            componentCount: nuclearResult.recreatedFiles.length,
            buildTime: Date.now() - startTime
          },
          changes: {
            eliminatedComponents: nuclearResult.deletedFiles.map(f => path.basename(f, '.tsx')),
            eliminatedDependencies: [],
            restoredComponents: nuclearResult.recreatedFiles
          },
          errors: nuclearResult.testsPassed ? [] : ['Some tests failed after nuclear optimization'],
          performance: {
            loadTime: 0,
            jsErrors: [],
            routesValidated: [],
            // Store nuclear-specific metrics in a different way
            ...(nuclearResult.testsPassed ? {} : { jsErrors: ['Nuclear optimization test failed'] })
          } as PhaseResult['performance']
        };
      } catch (error) {
        console.error('☢️  NUCLEAR OPTIMIZATION FAILED:', error);
        // Fall through to regular ALPHA phase
      }
    }
    
    // Regular ALPHA phase
    console.log('🗑️  ALPHA: Eliminating unused components...');

    try {
      // 1. Identify elimination candidates
      const eliminationData = await this.componentAnalyzer.identifyEliminationCandidates(projectPath);
      
      console.log(`🎯 Found ${eliminationData.eliminationCandidates.length} unused components to eliminate`);
      console.log(`   🚀 Using AGGRESSIVE elimination strategy`);
      
      // 2. AGGRESSIVE: Eliminate ALL candidates, not just "safe" ones
      // We'll use headless testing to verify and CHARLIE phase to recover if needed
      const eliminationResult = await this.componentAnalyzer.eliminateUnusedComponents(
        projectPath, 
        eliminationData.safeCandidates  // Still use safeCandidates but they're now much more aggressive
      );

      // 3. Update package.json to remove unused dependencies
      await this.componentAnalyzer.removeUnusedPackages(projectPath, eliminationResult.removedPackages);

      // 4. Test the changes - CRITICAL for aggressive elimination
      let performance: PhaseResult['performance'] = {};
      let errors: string[] = [];
      let shouldTriggerCharlie = false;
      
      // Always test in aggressive mode unless explicitly disabled
      if (config.autoTest !== false) {
        try {
          console.log(`   🧪 Testing app after eliminating ${eliminationResult.removedComponents.length} components...`);
          const validationResult = await this.validator.validateApplication(projectPath);
          performance = validationResult;
          errors = validationResult.jsErrors || [];
          
          if (!validationResult.success || errors.length > 0) {
            console.log(`   ❌ App broken! Errors detected: ${errors.length}`);
            shouldTriggerCharlie = true;
          } else {
            console.log(`   ✅ App still works after aggressive elimination!`);
          }
        } catch (testError) {
          console.log(`   ❌ Testing failed: ${testError.message}`);
          errors.push(`Testing failed: ${testError.message}`);
          shouldTriggerCharlie = true;
        }
      }

      // 5. Capture new metrics
      const postBuildMetrics = await this.metricsTracker.captureMetrics(projectPath, 'alpha');

      const buildTime = Date.now() - startTime;

      // 6. Save ALPHA results (including broken state if needed)
      const alphaData = {
        timestamp: new Date().toISOString(),
        eliminatedComponents: eliminationResult.removedComponents,
        eliminatedPackages: eliminationResult.removedPackages,
        buildMetrics: postBuildMetrics,
        performance,
        errors,
        needsRecovery: shouldTriggerCharlie
      };
      
      const alphaPath = path.join(projectPath, 'alpha-elimination.json');
      await fs.writeFile(alphaPath, JSON.stringify(alphaData, null, 2));

      // Mark success as false if we need CHARLIE recovery
      const success = errors.length === 0 && !shouldTriggerCharlie;
      
      return {
        phase: 'alpha',
        success,
        metrics: {
          bundleSize: postBuildMetrics.totalSize,
          dependencyCount: postBuildMetrics.dependencyCount || 0,
          componentCount: postBuildMetrics.componentCount || 0,
          buildTime
        },
        changes: {
          eliminatedComponents: eliminationResult.removedComponents,
          eliminatedDependencies: eliminationResult.removedPackages,
          restoredComponents: []
        },
        errors,
        performance
      };
      
    } catch (error) {
      return {
        phase: 'alpha',
        success: false,
        metrics: {
          bundleSize: zuluResult.metrics.bundleSize,
          dependencyCount: zuluResult.metrics.dependencyCount,
          componentCount: zuluResult.metrics.componentCount,
          buildTime: Date.now() - startTime
        },
        changes: {
          eliminatedComponents: [],
          eliminatedDependencies: [],
          restoredComponents: []
        },
        errors: [`ALPHA phase failed: ${error.message}`],
        performance: {}
      };
    }
  }

  /**
   * BETA Phase: Refine dependencies and optimize remaining components
   */
  private async executeBetaPhase(
    projectPath: string, 
    config: SmartOptimizationConfig,
    previousPhases: PhaseResult[]
  ): Promise<PhaseResult> {
    console.log('🔧 BETA: Refining dependencies...');
    
    const startTime = Date.now();
    const alphaResult = previousPhases.find(p => p.phase === 'alpha');
    
    if (!alphaResult || !alphaResult.success) {
      // Skip BETA if ALPHA failed
      return {
        phase: 'beta',
        success: false,
        metrics: alphaResult?.metrics || { bundleSize: '0', dependencyCount: 0, componentCount: 0, buildTime: 0 },
        changes: { eliminatedComponents: [], eliminatedDependencies: [], restoredComponents: [] },
        errors: ['BETA skipped: ALPHA phase failed'],
        performance: {}
      };
    }

    try {
      // 1. Analyze remaining dependencies for optimization opportunities
      const refinementData = await this.componentAnalyzer.analyzeRefinementOpportunities(projectPath);
      
      // 2. Apply micro-optimizations
      const refinementResult = await this.componentAnalyzer.applyRefinements(projectPath, refinementData);

      // 3. Test refinements
      let performance: PhaseResult['performance'] = {};
      let errors: string[] = [];
      
      if (config.autoTest) {
        try {
          performance = await this.validator.validateApplication(projectPath);
          errors = performance.jsErrors || [];
        } catch (testError) {
          errors.push(`Testing failed: ${testError.message}`);
        }
      }

      // 4. Capture metrics
      const postBuildMetrics = await this.metricsTracker.captureMetrics(projectPath, 'beta');
      const buildTime = Date.now() - startTime;

      // 5. Save BETA results
      const betaData = {
        timestamp: new Date().toISOString(),
        refinements: refinementResult.appliedRefinements,
        buildMetrics: postBuildMetrics,
        performance,
        errors
      };
      
      const betaPath = path.join(projectPath, 'beta-refinement.json');
      await fs.writeFile(betaPath, JSON.stringify(betaData, null, 2));

      const success = errors.length === 0;
      
      return {
        phase: 'beta',
        success,
        metrics: {
          bundleSize: postBuildMetrics.totalSize,
          dependencyCount: postBuildMetrics.dependencyCount || 0,
          componentCount: postBuildMetrics.componentCount || 0,
          buildTime
        },
        changes: {
          eliminatedComponents: [],
          eliminatedDependencies: refinementResult.eliminatedDependencies || [],
          restoredComponents: []
        },
        errors,
        performance
      };
      
    } catch (error) {
      return {
        phase: 'beta',
        success: false,
        metrics: alphaResult.metrics,
        changes: { eliminatedComponents: [], eliminatedDependencies: [], restoredComponents: [] },
        errors: [`BETA phase failed: ${error.message}`],
        performance: {}
      };
    }
  }

  /**
   * CHARLIE Phase: Binary search recovery
   */
  private async executeCharliePhase(
    projectPath: string, 
    config: SmartOptimizationConfig,
    previousPhases: PhaseResult[]
  ): Promise<PhaseResult> {
    console.log('🔍 CHARLIE: Binary search recovery - finding optimal elimination point...');
    
    const startTime = Date.now();
    const alphaPhase = previousPhases.find(p => p.phase === 'alpha');
    
    if (!alphaPhase || alphaPhase.success) {
      console.log('   ℹ️  No recovery needed - ALPHA succeeded');
      return {
        phase: 'charlie',
        success: true,
        metrics: previousPhases[previousPhases.length - 1].metrics,
        changes: { eliminatedComponents: [], eliminatedDependencies: [], restoredComponents: [] },
        errors: [],
        performance: {}
      };
    }

    console.log(`   📊 ALPHA eliminated ${alphaPhase.changes.eliminatedComponents.length} components and broke the app`);
    console.log(`   🎯 Finding the exact point where the app breaks...`);

    try {
      // Use binary search to find the maximum number of components we can eliminate
      const recoveryResult = await this.recovery.performBinarySearchRecovery(
        projectPath,
        alphaPhase,
        this.validator,  // Always use validator in CHARLIE
        {
          maxIterations: 20,
          testEachIteration: true,
          preserveCritical: ['App', 'Router', 'QueryClient'],
          recoveryStrategy: 'aggressive'  // Use aggressive strategy
        }
      );

      const buildTime = Date.now() - startTime;
      
      return {
        phase: 'charlie',
        success: recoveryResult.success,
        metrics: {
          bundleSize: recoveryResult.finalMetrics?.totalSize || '0',
          dependencyCount: recoveryResult.minimalDependencies.length,
          componentCount: recoveryResult.minimalComponents.length,
          buildTime
        },
        changes: {
          eliminatedComponents: [],
          eliminatedDependencies: [],
          restoredComponents: recoveryResult.restoredComponents
        },
        errors: recoveryResult.errors,
        performance: recoveryResult.performance || {}
      };
      
    } catch (error) {
      return {
        phase: 'charlie',
        success: false,
        metrics: alphaPhase.metrics,
        changes: { eliminatedComponents: [], eliminatedDependencies: [], restoredComponents: [] },
        errors: [`CHARLIE phase failed: ${error.message}`],
        performance: {}
      };
    }
  }

  /**
   * Generate comprehensive final report
   */
  private async generateFinalReport(
    projectPath: string,
    phases: PhaseResult[],
    config: SmartOptimizationConfig
  ): Promise<SmartOptimizationResult> {
    const zuluPhase = phases.find(p => p.phase === 'zulu');
    const finalPhase = phases[phases.length - 1];
    
    if (!zuluPhase || !finalPhase) {
      throw new Error('Missing phase data for report generation');
    }

    // Calculate reductions
    const bundleSizeReduction = this.calculateBundleReduction(
      zuluPhase.metrics.bundleSize, 
      finalPhase.metrics.bundleSize
    );
    
    const dependencyReduction = zuluPhase.metrics.dependencyCount - finalPhase.metrics.dependencyCount;
    const componentReduction = zuluPhase.metrics.componentCount - finalPhase.metrics.componentCount;

    // Generate recommendations
    const recommendations = this.generateRecommendations(phases);

    // Create final report
    const report = {
      timestamp: new Date().toISOString(),
      config,
      phases,
      summary: {
        totalReduction: {
          bundleSize: `${bundleSizeReduction.absolute}`,
          percentageReduction: bundleSizeReduction.percentage,
          dependencyReduction,
          componentReduction
        },
        recommendations
      }
    };

    const reportPath = path.join(projectPath, 'smart-optimization-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    // Generate human-readable markdown report
    await this.generateMarkdownReport(projectPath, report);

    const success = phases.every(p => p.success);

    return {
      success,
      phases,
      totalReduction: {
        bundleSize: `${bundleSizeReduction.absolute}`,
        percentageReduction: bundleSizeReduction.percentage,
        dependencyReduction,
        componentReduction
      },
      recommendations,
      reportPath
    };
  }

  private calculateBundleReduction(beforeSize: string, afterSize: string): { absolute: string, percentage: number } {
    const beforeKB = this.parseBundleSize(beforeSize);
    const afterKB = this.parseBundleSize(afterSize);
    const reductionKB = beforeKB - afterKB;
    const percentage = beforeKB > 0 ? Math.round((reductionKB / beforeKB) * 100) : 0;
    
    return {
      absolute: `${reductionKB} KB`,
      percentage
    };
  }

  private parseBundleSize(sizeStr: string): number {
    const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*KB/i);
    return match ? parseFloat(match[1]) : 0;
  }

  private generateRecommendations(phases: PhaseResult[]): string[] {
    const recommendations: string[] = [];
    
    const finalPhase = phases[phases.length - 1];
    const zuluPhase = phases.find(p => p.phase === 'zulu');
    
    if (zuluPhase && finalPhase) {
      const reductionPercent = this.calculateBundleReduction(
        zuluPhase.metrics.bundleSize,
        finalPhase.metrics.bundleSize
      ).percentage;
      
      if (reductionPercent > 50) {
        recommendations.push('Excellent optimization! Consider running this regularly.');
      } else if (reductionPercent > 20) {
        recommendations.push('Good optimization results. Monitor for future improvements.');
      } else {
        recommendations.push('Limited optimization gains. Consider more aggressive settings.');
      }
    }

    // Add phase-specific recommendations
    phases.forEach(phase => {
      if (!phase.success) {
        recommendations.push(`${phase.phase.toUpperCase()} phase failed: Consider reviewing errors and running in recovery mode.`);
      }
    });

    return recommendations;
  }

  private async generateMarkdownReport(projectPath: string, report: any): Promise<void> {
    const markdown = `# Smart Bundle Optimization Report

Generated: ${report.timestamp}
Mode: ${report.config.mode}
Phases: ${report.config.phases.join(' → ')}

## Summary

${report.phases.map(phase => `
### ${phase.phase.toUpperCase()} Phase
- **Status**: ${phase.success ? '✅ Success' : '❌ Failed'}
- **Bundle Size**: ${phase.metrics.bundleSize}
- **Dependencies**: ${phase.metrics.dependencyCount}
- **Components**: ${phase.metrics.componentCount}
- **Build Time**: ${phase.metrics.buildTime}ms
${phase.errors.length > 0 ? `- **Errors**: ${phase.errors.join(', ')}` : ''}
`).join('')}

## Total Reduction
- **Bundle Size**: ${report.summary.totalReduction.bundleSize} (${report.summary.totalReduction.percentageReduction}% reduction)
- **Dependencies**: ${report.summary.totalReduction.dependencyReduction} fewer
- **Components**: ${report.summary.totalReduction.componentReduction} fewer

## Recommendations
${report.summary.recommendations.map(rec => `- ${rec}`).join('\n')}

---
*Generated by Replrod Smart Bundle Optimization*
`;

    const markdownPath = path.join(projectPath, 'optimization-report.md');
    await fs.writeFile(markdownPath, markdown);
  }
}
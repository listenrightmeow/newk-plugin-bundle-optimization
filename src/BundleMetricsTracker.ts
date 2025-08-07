import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import glob from 'fast-glob';

const execAsync = promisify(exec);

export interface BundleMetrics {
  timestamp: string;
  phase: string;
  totalSize: string;
  totalSizeKB: number;
  cssSize: string;
  cssSizeKB: number;
  jsSize: string;
  jsSizeKB: number;
  chunkCount: number;
  chunks: ChunkInfo[];
  dependencyCount?: number;
  componentCount?: number;
  buildTime: number;
  buildOutput: string;
}

export interface ChunkInfo {
  name: string;
  size: string;
  sizeKB: number;
  type: 'js' | 'css' | 'html' | 'asset';
}

export interface MetricsComparison {
  before: BundleMetrics;
  after: BundleMetrics;
  reduction: {
    totalSizeKB: number;
    totalSizePercent: number;
    cssReductionKB: number;
    jsReductionKB: number;
    chunkReduction: number;
    dependencyReduction: number;
    componentReduction: number;
  };
  improvements: string[];
  regressions: string[];
}

export interface HistoricalMetrics {
  project: string;
  optimizations: Array<{
    date: string;
    mode: string;
    phases: string[];
    results: BundleMetrics[];
  }>;
}

/**
 * BundleMetricsTracker - Captures and compares bundle metrics between optimization phases
 * 
 * Features:
 * - Build and capture bundle size data
 * - Parse Vite build output for detailed chunk analysis
 * - Compare metrics between phases
 * - Track historical optimization data
 * - Generate performance insights
 */
export class BundleMetricsTracker {

  /**
   * Capture baseline metrics (ZULU phase)
   */
  async captureBaseline(projectPath: string): Promise<BundleMetrics> {
    console.log('📊 Capturing baseline bundle metrics...');
    return this.captureMetrics(projectPath, 'zulu');
  }

  /**
   * Capture metrics for any phase
   */
  async captureMetrics(projectPath: string, phase: string): Promise<BundleMetrics> {
    const startTime = Date.now();
    
    try {
      // 1. Clean any existing build
      await this.cleanBuild(projectPath);
      
      // 2. Run build and capture output
      const buildOutput = await this.runBuild(projectPath);
      const buildTime = Date.now() - startTime;
      
      // 3. Parse build output for metrics
      const chunks = this.parseBuildOutput(buildOutput);
      
      // 4. Calculate totals
      const totals = this.calculateTotals(chunks);
      
      // 5. Count dependencies and components
      const counts = await this.countDependenciesAndComponents(projectPath);

      const metrics: BundleMetrics = {
        timestamp: new Date().toISOString(),
        phase,
        totalSize: this.formatSize(totals.totalKB),
        totalSizeKB: totals.totalKB,
        cssSize: this.formatSize(totals.cssKB),
        cssSizeKB: totals.cssKB,
        jsSize: this.formatSize(totals.jsKB),
        jsSizeKB: totals.jsKB,
        chunkCount: chunks.length,
        chunks,
        dependencyCount: counts.dependencies,
        componentCount: counts.components,
        buildTime,
        buildOutput
      };

      // 6. Save metrics to file
      const metricsPath = path.join(projectPath, `${phase}-metrics.json`);
      await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2));

      console.log(`✅ ${phase.toUpperCase()} metrics captured:`);
      console.log(`   📦 Total Size: ${metrics.totalSize}`);
      console.log(`   🎨 CSS: ${metrics.cssSize}`);
      console.log(`   ⚡ JS: ${metrics.jsSize}`);
      console.log(`   📄 Chunks: ${metrics.chunkCount}`);
      console.log(`   🔗 Dependencies: ${metrics.dependencyCount}`);
      console.log(`   🧩 Components: ${metrics.componentCount}`);
      console.log(`   ⏱️  Build Time: ${metrics.buildTime}ms`);

      return metrics;

    } catch (error) {
      console.error(`Failed to capture ${phase} metrics:`, error.message);
      throw error;
    }
  }

  /**
   * Compare metrics between two phases
   */
  compareMetrics(before: BundleMetrics, after: BundleMetrics): MetricsComparison {
    console.log(`🔍 Comparing ${before.phase} vs ${after.phase} metrics...`);

    const reduction = {
      totalSizeKB: before.totalSizeKB - after.totalSizeKB,
      totalSizePercent: before.totalSizeKB > 0 
        ? Math.round(((before.totalSizeKB - after.totalSizeKB) / before.totalSizeKB) * 100)
        : 0,
      cssReductionKB: before.cssSizeKB - after.cssSizeKB,
      jsReductionKB: before.jsSizeKB - after.jsSizeKB,
      chunkReduction: before.chunkCount - after.chunkCount,
      dependencyReduction: (before.dependencyCount || 0) - (after.dependencyCount || 0),
      componentReduction: (before.componentCount || 0) - (after.componentCount || 0)
    };

    const improvements: string[] = [];
    const regressions: string[] = [];

    // Analyze improvements and regressions
    if (reduction.totalSizeKB > 0) {
      improvements.push(`Bundle size reduced by ${this.formatSize(reduction.totalSizeKB)} (${reduction.totalSizePercent}%)`);
    } else if (reduction.totalSizeKB < 0) {
      regressions.push(`Bundle size increased by ${this.formatSize(Math.abs(reduction.totalSizeKB))} (${Math.abs(reduction.totalSizePercent)}%)`);
    }

    if (reduction.jsReductionKB > 0) {
      improvements.push(`JavaScript reduced by ${this.formatSize(reduction.jsReductionKB)}`);
    } else if (reduction.jsReductionKB < 0) {
      regressions.push(`JavaScript increased by ${this.formatSize(Math.abs(reduction.jsReductionKB))}`);
    }

    if (reduction.chunkReduction > 0) {
      improvements.push(`${reduction.chunkReduction} fewer chunks`);
    } else if (reduction.chunkReduction < 0) {
      regressions.push(`${Math.abs(reduction.chunkReduction)} more chunks`);
    }

    if (reduction.dependencyReduction > 0) {
      improvements.push(`${reduction.dependencyReduction} fewer dependencies`);
    }

    if (reduction.componentReduction > 0) {
      improvements.push(`${reduction.componentReduction} fewer components`);
    }

    if (after.buildTime < before.buildTime) {
      improvements.push(`Build time improved by ${before.buildTime - after.buildTime}ms`);
    } else if (after.buildTime > before.buildTime) {
      regressions.push(`Build time increased by ${after.buildTime - before.buildTime}ms`);
    }

    console.log(`✅ Improvements: ${improvements.length}`);
    console.log(`⚠️  Regressions: ${regressions.length}`);

    return {
      before,
      after,
      reduction,
      improvements,
      regressions
    };
  }

  /**
   * Generate comprehensive metrics report
   */
  async generateMetricsReport(
    projectPath: string, 
    allMetrics: BundleMetrics[]
  ): Promise<string> {
    if (allMetrics.length === 0) {
      throw new Error('No metrics to generate report from');
    }

    const baseline = allMetrics[0];
    const final = allMetrics[allMetrics.length - 1];
    
    let report = `# Bundle Optimization Metrics Report\n\n`;
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `Project: ${path.basename(projectPath)}\n\n`;

    // Summary
    report += `## Summary\n\n`;
    if (allMetrics.length > 1) {
      const comparison = this.compareMetrics(baseline, final);
      report += `**Total Reduction**: ${this.formatSize(comparison.reduction.totalSizeKB)} (${comparison.reduction.totalSizePercent}%)\n`;
      report += `**Dependencies Removed**: ${comparison.reduction.dependencyReduction}\n`;
      report += `**Components Removed**: ${comparison.reduction.componentReduction}\n`;
      report += `**Chunks**: ${baseline.chunkCount} → ${final.chunkCount}\n\n`;
    }

    // Phase-by-phase breakdown
    report += `## Phase Results\n\n`;
    report += `| Phase | Bundle Size | JS Size | CSS Size | Chunks | Dependencies | Build Time |\n`;
    report += `|-------|-------------|---------|----------|--------|--------------|------------|\n`;
    
    for (const metrics of allMetrics) {
      report += `| ${metrics.phase.toUpperCase()} | ${metrics.totalSize} | ${metrics.jsSize} | ${metrics.cssSize} | ${metrics.chunkCount} | ${metrics.dependencyCount || 'N/A'} | ${metrics.buildTime}ms |\n`;
    }
    report += '\n';

    // Detailed chunk analysis
    report += `## Detailed Chunk Analysis\n\n`;
    for (const metrics of allMetrics) {
      report += `### ${metrics.phase.toUpperCase()} Phase Chunks\n\n`;
      report += `| Chunk Name | Size | Type |\n`;
      report += `|------------|------|------|\n`;
      
      for (const chunk of metrics.chunks.sort((a, b) => b.sizeKB - a.sizeKB)) {
        report += `| ${chunk.name} | ${chunk.size} | ${chunk.type} |\n`;
      }
      report += '\n';
    }

    // Recommendations
    report += `## Recommendations\n\n`;
    if (allMetrics.length > 1) {
      const comparison = this.compareMetrics(baseline, final);
      
      if (comparison.reduction.totalSizePercent > 50) {
        report += `- 🎉 Excellent optimization! ${comparison.reduction.totalSizePercent}% reduction achieved.\n`;
      } else if (comparison.reduction.totalSizePercent > 20) {
        report += `- ✅ Good optimization results with ${comparison.reduction.totalSizePercent}% reduction.\n`;
      } else if (comparison.reduction.totalSizePercent > 0) {
        report += `- 📈 Modest improvements with ${comparison.reduction.totalSizePercent}% reduction.\n`;
        report += `- 💡 Consider more aggressive optimization settings for better results.\n`;
      } else {
        report += `- ⚠️ No bundle size reduction achieved. Review optimization settings.\n`;
      }

      if (final.chunkCount > 10) {
        report += `- 📦 Consider consolidating chunks - ${final.chunkCount} chunks may impact loading performance.\n`;
      }

      const largestChunk = final.chunks.reduce((max, chunk) => 
        chunk.sizeKB > max.sizeKB ? chunk : max, final.chunks[0]
      );
      
      if (largestChunk.sizeKB > 500) {
        report += `- 🚨 Largest chunk (${largestChunk.name}: ${largestChunk.size}) exceeds recommended size. Consider code splitting.\n`;
      }
    }

    // Save report
    const reportPath = path.join(projectPath, 'bundle-metrics-report.md');
    await fs.writeFile(reportPath, report);

    console.log(`📊 Metrics report saved to: bundle-metrics-report.md`);
    return reportPath;
  }

  /**
   * Store ZULU baseline metrics for benchmark comparison
   */
  async storeZuluBaseline(projectPath: string, metrics: BundleMetrics): Promise<void> {
    const baselinePath = path.join(projectPath, '.newk-zulu-baseline.json');
    try {
      await fs.writeFile(baselinePath, JSON.stringify(metrics, null, 2));
      console.log('📊 ZULU baseline metrics saved for benchmark comparison');
    } catch (error) {
      console.warn(`Failed to store ZULU baseline: ${error.message}`);
    }
  }

  /**
   * Load ZULU baseline metrics for benchmark comparison
   */
  async loadZuluBaseline(projectPath: string): Promise<BundleMetrics | null> {
    const baselinePath = path.join(projectPath, '.newk-zulu-baseline.json');
    try {
      const data = await fs.readFile(baselinePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Store historical optimization data
   */
  async storeHistoricalData(
    projectPath: string,
    mode: string,
    phases: string[],
    results: BundleMetrics[]
  ): Promise<void> {
    const historyPath = path.join(projectPath, 'optimization-history.json');
    
    try {
      let history: HistoricalMetrics;
      
      try {
        const existing = await fs.readFile(historyPath, 'utf-8');
        history = JSON.parse(existing);
      } catch {
        history = {
          project: path.basename(projectPath),
          optimizations: []
        };
      }

      history.optimizations.push({
        date: new Date().toISOString(),
        mode,
        phases,
        results
      });

      // Keep only last 10 optimization runs
      if (history.optimizations.length > 10) {
        history.optimizations = history.optimizations.slice(-10);
      }

      await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
      console.log('💾 Historical data saved');

    } catch (error) {
      console.warn(`Failed to store historical data: ${error.message}`);
    }
  }

  // Private helper methods

  private async cleanBuild(projectPath: string): Promise<void> {
    try {
      const distPath = path.join(projectPath, 'dist');
      await execAsync(`rm -rf "${distPath}"`);
    } catch (error) {
      // Ignore errors if dist doesn't exist
    }
  }

  private async runBuild(projectPath: string): Promise<string> {
    try {
      console.log('🔨 Running build...');
      const { stdout, stderr } = await execAsync('npm run build', {
        cwd: projectPath,
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      return stdout + stderr;
    } catch (error) {
      console.error('Build failed:', error.message);
      throw error;
    }
  }

  private parseBuildOutput(buildOutput: string): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];
    
    // Parse Vite build output
    // Examples: 
    // "../dist/public/index.html                   1.97 kB"
    // "../dist/public/assets/index-DFJMVbNs.css   41.66 kB"
    // "../dist/public/assets/index-k4dM5aCm.js   276.42 kB"
    const chunkRegex = /^\.\.\/dist\/public\/(?:assets\/)?(.+?)\s+(\d+(?:\.\d+)?)\s+(\w+)/gm;
    const matches = buildOutput.matchAll(chunkRegex);

    for (const match of matches) {
      const [, filename, size, unit] = match;
      const sizeKB = unit === 'kB' || unit === 'KB' ? parseFloat(size) : parseFloat(size) / 1024;
      
      let type: ChunkInfo['type'] = 'asset';
      if (filename.endsWith('.js')) type = 'js';
      else if (filename.endsWith('.css')) type = 'css';
      else if (filename.endsWith('.html')) type = 'html';

      chunks.push({
        name: filename,
        size: `${sizeKB.toFixed(2)} KB`,
        sizeKB,
        type
      });
    }

    return chunks.sort((a, b) => b.sizeKB - a.sizeKB);
  }

  private calculateTotals(chunks: ChunkInfo[]): { totalKB: number, cssKB: number, jsKB: number } {
    const totals = chunks.reduce((acc, chunk) => {
      acc.totalKB += chunk.sizeKB;
      if (chunk.type === 'css') acc.cssKB += chunk.sizeKB;
      if (chunk.type === 'js') acc.jsKB += chunk.sizeKB;
      return acc;
    }, { totalKB: 0, cssKB: 0, jsKB: 0 });

    return totals;
  }

  private async countDependenciesAndComponents(projectPath: string): Promise<{ dependencies: number, components: number }> {
    try {
      // Count dependencies from package.json
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const dependencies = Object.keys(packageJson.dependencies || {}).length + 
                          Object.keys(packageJson.devDependencies || {}).length;

      // Count UI components
      const uiComponentsPath = path.join(projectPath, 'client/src/components/ui');
      let components = 0;
      
      try {
        const uiFiles = await glob(`${uiComponentsPath}/*.tsx`);
        components = uiFiles.length;
      } catch {
        // UI components folder might not exist
      }

      return { dependencies, components };
    } catch (error) {
      console.warn(`Failed to count dependencies and components: ${error.message}`);
      return { dependencies: 0, components: 0 };
    }
  }

  private formatSize(sizeKB: number): string {
    if (sizeKB >= 1024) {
      return `${(sizeKB / 1024).toFixed(2)} MB`;
    }
    return `${sizeKB.toFixed(2)} KB`;
  }
}
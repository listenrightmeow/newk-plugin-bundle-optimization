// Type definitions for @listenrightmeow/newk-plugin-bundle-optimization

export type OptimizationMode = 'safe' | 'smart' | 'aggressive' | 'nuclear';

export type OptimizationPhase = 'zulu' | 'alpha' | 'beta' | 'charlie';

export interface OptimizationResult {
  success: boolean;
  phasesCompleted: OptimizationPhase[];
  metrics: BundleMetrics;
  errors?: string[];
  warnings?: string[];
  summary: OptimizationSummary;
}

export interface BundleMetrics {
  originalSize: number;
  optimizedSize: number;
  reduction: number;
  reductionPercentage: number;
  componentsRemoved: number;
  dependenciesRemoved: number;
  buildTime: number;
}

export interface ComponentAnalysis {
  name: string;
  path: string;
  size: number;
  used: boolean;
  imports: string[];
  exports: string[];
  dependencies: string[];
}

export interface DependencyInfo {
  name: string;
  version: string;
  size: number;
  used: boolean;
  importedBy: string[];
  canBeRemoved: boolean;
}

export interface OptimizationSummary {
  mode: OptimizationMode;
  startTime: Date;
  endTime: Date;
  duration: number;
  bundleSizeBefore: number;
  bundleSizeAfter: number;
  percentageReduction: number;
  componentsAnalyzed: number;
  componentsRemoved: number;
  dependenciesAnalyzed: number;
  dependenciesRemoved: number;
  errors: string[];
  warnings: string[];
}

export interface PluginConfig {
  mode?: OptimizationMode;
  phases?: OptimizationPhase[];
  targetReduction?: number;
  autoRecover?: boolean;
  benchmark?: boolean;
  visualize?: boolean;
  safe?: boolean;
  preserve?: string[];
  projectPath?: string;
}

export interface NuclearConfig {
  deleteEverything?: boolean;
  binarySearchRestore?: boolean;
  maxIterations?: number;
  validationCommand?: string;
  recoveryStrategy?: 'aggressive' | 'conservative';
}
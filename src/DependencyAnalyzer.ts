import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from '@babel/parser';
import * as babel from '@babel/traverse';
const traverse = babel.default;
import glob from 'fast-glob';

interface DependencyNode {
  name: string;
  type: 'import' | 'function' | 'component' | 'variable';
  usages: Set<string>;
  dependencies: Set<string>;
  weight: number;
  isEntryPoint: boolean;
}

interface CallGraphEdge {
  from: string;
  to: string;
  type: 'call' | 'render' | 'import' | 'reference';
  weight: number;
}

interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: CallGraphEdge[];
  entryPoints: Set<string>;
}

interface ComponentAnalysis {
  renderedComponents: Set<string>;
  unrenderedComponents: Set<string>;
  unusedProps: Map<string, string[]>;
  unusedEventHandlers: Set<string>;
  unusedStyles: Set<string>;
}

interface DataFlowAnalysis {
  reachableFromEntry: Set<string>;
  deadCodeBranches: Set<string>;
  unusedImports: Set<string>;
  typeOnlyImports: Set<string>;
  transitivelyUnused: Set<string>;
}

interface BundleSplitAnalysis {
  criticalPath: string[];
  cohesiveClusters: string[][];
  lazyLoadCandidates: string[];
  splitPoints: Map<string, number>;
  clusterRecommendations?: any; // Phase 4: Enhanced clustering recommendations
}

interface DependencyAnalysis {
  filesScanned: number;
  dependencyGraph: DependencyGraph;
  componentAnalysis: ComponentAnalysis;
  dataFlowAnalysis: DataFlowAnalysis;
  bundleSplitAnalysis: BundleSplitAnalysis;
  usedDependencies: Set<string>;
  unusedDependencies: string[];
  serverSideDependencies: string[];
  heavyDependencies: string[];
  recommendations: string[];
}

export class DependencyAnalyzer {
  // Cache for parsed imports to avoid re-parsing identical files
  private importCache: Map<string, Set<string>> = new Map();
  
  private serverSidePackages = [
    'express', 'fastify', 'koa', 'hapi',
    'drizzle-orm', 'prisma', 'mongoose', 'sequelize',
    'passport', 'express-session', 'connect',
    'ws', 'socket.io', 'pg', 'mysql2', 'sqlite3',
    '@neondatabase/serverless', 'connect-pg-simple',
    'memorystore', 'redis', 'ioredis'
  ];
  
  private heavyPackages = [
    // Charting libraries
    'recharts', 'chart.js', 'd3', 'victory', 'nivo',
    // Date/time libraries  
    'moment', 'date-fns', 'dayjs', 'luxon',
    // Utility libraries
    'lodash', 'underscore', 'ramda', 'clsx', 'tailwind-merge',
    // Animation libraries
    'framer-motion', '@react-spring/web', 'react-spring',
    // Data fetching
    '@tanstack/react-query', 'apollo-client', 'swr', 'axios',
    // 3D/Graphics
    'three', 'babylonjs', 'pixi.js',
    // ALL Radix UI components - be very aggressive
    '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-select', '@radix-ui/react-popover',
    '@radix-ui/react-context-menu', '@radix-ui/react-tooltip',
    '@radix-ui/react-navigation-menu', '@radix-ui/react-toast',
    '@radix-ui/react-accordion', '@radix-ui/react-alert-dialog',
    '@radix-ui/react-aspect-ratio', '@radix-ui/react-avatar',
    '@radix-ui/react-checkbox', '@radix-ui/react-collapsible',
    '@radix-ui/react-hover-card', '@radix-ui/react-label',
    '@radix-ui/react-menubar', '@radix-ui/react-progress',
    '@radix-ui/react-radio-group', '@radix-ui/react-scroll-area',
    '@radix-ui/react-separator', '@radix-ui/react-slider',
    '@radix-ui/react-switch', '@radix-ui/react-tabs',
    '@radix-ui/react-toggle', '@radix-ui/react-toggle-group',
    '@radix-ui/react-slot', // Even small ones
    // Icons can be heavy
    'lucide-react', 'react-icons',
    // Other heavy deps
    'react-day-picker', 'react-resizable-panels',
    'cmdk', 'vaul', 'input-otp', 'embla-carousel-react',
    'react-helmet-async', 'next-themes',
    // Any dependency over ~10KB should be considered heavy
    'class-variance-authority', 'tailwindcss-animate',
    'zod', 'react-hook-form', '@hookform/resolvers'
  ];

  async analyze(projectPath: string): Promise<DependencyAnalysis> {
    const startTime = Date.now();
    const sourceFiles = await this.findSourceFiles(projectPath);
    let filesScanned = sourceFiles.length;

    console.log(`🔍 Starting component-first dependency analysis...`);

    // Run PHASE 1 & 2 in parallel since they're independent
    const [componentDependencies, buildDependencies] = await Promise.all([
      // PHASE 1: Component-first scanning (SOURCE OF TRUTH)
      // If found in components, NEVER remove - this is sacred
      this.scanComponentsFirst(sourceFiles, projectPath).then(deps => {
        console.log(`🧩 Phase 1: Found ${deps.size} dependencies in components`);
        return deps;
      }),
      
      // PHASE 2: Build dependency scanning (ESSENTIAL TOOLS)
      // Config files - build tools only, don't determine component usage
      this.scanBuildDependencies(sourceFiles, projectPath).then(deps => {
        console.log(`🔧 Phase 2: Found ${deps.size} build dependencies`);
        return deps;
      })
    ]);

    // PHASE 3: Conservative transitive resolution
    // BFS from component deps - but conservative approach
    const transitiveDependencies = await this.resolveTransitiveDependencies(
      componentDependencies, projectPath
    );
    console.log(`🔗 Phase 3: Found ${transitiveDependencies.size} transitive dependencies`);

    // PHASE 4: Combine all required dependencies
    const usedDependencies = new Set<string>([
      ...componentDependencies,     // Always keep - found in components
      ...buildDependencies,         // Always keep - needed for build
      ...transitiveDependencies     // Keep if essential for component deps
    ]);

    console.log(`✅ Combined: ${usedDependencies.size} total required dependencies`);

    // Run legacy analyses in parallel for better performance
    const [dependencyGraph, ...analyses] = await Promise.all([
      this.buildSimplifiedDependencyGraph(sourceFiles, usedDependencies),
      // These will run after dependencyGraph is ready
    ]);
    
    const [dataFlowAnalysis, componentAnalysis] = await Promise.all([
      this.performSimplifiedDataFlowAnalysis(dependencyGraph),
      this.analyzeComponentDependencies(sourceFiles, dependencyGraph)
    ]);
    
    const bundleSplitAnalysis = await this.analyzeBundleSplitting(dependencyGraph, componentAnalysis);

    // Compare with package.json
    const packageJson = await this.loadPackageJson(projectPath);
    
    // CRITICAL: Only consider runtime dependencies for removal
    // DevDependencies are build tools and should NEVER be removed
    const runtimeDependencies = packageJson.dependencies || {};
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    const unusedDependencies = Object.keys(runtimeDependencies)
      .filter(dep => !usedDependencies.has(dep))
      .filter(dep => !this.isEssentialDependency(dep));

    const serverSideDependencies = Object.keys(runtimeDependencies)
      .filter(dep => this.isServerSideDependency(dep));

    const heavyDependencies = Array.from(usedDependencies)
      .filter(dep => this.isHeavyDependency(dep));

    const recommendations = this.generateAdvancedRecommendations(
      dependencyGraph,
      dataFlowAnalysis,
      componentAnalysis,
      bundleSplitAnalysis,
      usedDependencies,
      unusedDependencies,
      serverSideDependencies,
      heavyDependencies
    );

    const analysisTime = Date.now() - startTime;
    console.log(`⚡ Analysis completed in ${analysisTime}ms`);

    return {
      filesScanned,
      dependencyGraph,
      componentAnalysis,
      dataFlowAnalysis,
      bundleSplitAnalysis,
      usedDependencies,
      unusedDependencies,
      serverSideDependencies,
      heavyDependencies,
      recommendations
    };
  }
  
  private async findSourceFiles(projectPath: string): Promise<string[]> {
    const patterns = [
      `${projectPath}/client/src/**/*.{js,jsx,ts,tsx}`,
      `${projectPath}/src/**/*.{js,jsx,ts,tsx}`,
      `${projectPath}/tailwind.config.{js,ts}`,
      `${projectPath}/postcss.config.{js,ts}`,
      `${projectPath}/vite.config.{js,ts}`,
      `!${projectPath}/**/node_modules/**`,
      `!${projectPath}/**/dist/**`,
      `!${projectPath}/**/build/**`
    ];
    
    return glob(patterns);
  }

  // PHASE 1: Component-first scanning - SOURCE OF TRUTH
  private async scanComponentsFirst(sourceFiles: string[], projectPath: string): Promise<Set<string>> {
    const componentDeps = new Set<string>();
    
    // Filter to component files only
    const componentFiles = sourceFiles.filter(file => 
      file.includes('/components/') || 
      file.includes('/pages/') ||
      file.includes('/views/') ||
      file.includes('App.tsx') || file.includes('App.jsx') ||
      file.includes('main.tsx') || file.includes('main.jsx') ||
      file.includes('index.tsx') || file.includes('index.jsx')
    );
    
    console.log(`🧩 Scanning ${componentFiles.length} component files...`);
    
    // Process files in parallel for better performance
    const BATCH_SIZE = 10; // Process 10 files concurrently
    const results: Set<string>[] = [];
    
    for (let i = 0; i < componentFiles.length; i += BATCH_SIZE) {
      const batch = componentFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (file) => {
          const fileDeps = new Set<string>();
          try {
            const content = await fs.readFile(file, 'utf-8');
            
            // Extract all imports
            const imports = await this.extractComponentImports(content, file);
            imports.forEach(imp => fileDeps.add(imp));
            
            // Extract Tailwind plugin usage from className attributes
            const tailwindPlugins = this.extractTailwindPluginUsage(content);
            tailwindPlugins.forEach(plugin => fileDeps.add(plugin));
          } catch (error) {
            console.warn(`Failed to scan component ${file}:`, error.message);
          }
          return fileDeps;
        })
      );
      results.push(...batchResults);
    }
    
    // Merge all results
    results.forEach(fileDeps => {
      fileDeps.forEach(dep => componentDeps.add(dep));
    });
    
    return componentDeps;
  }
  
  // PHASE 2: Build dependency scanning - ESSENTIAL TOOLS
  private async scanBuildDependencies(sourceFiles: string[], projectPath: string): Promise<Set<string>> {
    const buildDeps = new Set<string>();
    
    // Filter to config files only
    const configFiles = sourceFiles.filter(file =>
      file.includes('tailwind.config') ||
      file.includes('postcss.config') ||
      file.includes('vite.config')
    );
    
    console.log(`🔧 Scanning ${configFiles.length} config files...`);
    
    // Process all config files in parallel since there are typically few of them
    const configResults = await Promise.all(
      configFiles.map(async (file) => {
        try {
          const content = await fs.readFile(file, 'utf-8');
          return await this.extractConfigDependencies(content, file);
        } catch (error) {
          console.warn(`Failed to scan config ${file}:`, error.message);
          return [];
        }
      })
    );
    
    // Merge all results
    configResults.forEach(deps => {
      deps.forEach(dep => buildDeps.add(dep));
    });
    
    return buildDeps;
  }
  
  // PHASE 3: Conservative transitive resolution using BFS
  private async resolveTransitiveDependencies(componentDeps: Set<string>, projectPath: string): Promise<Set<string>> {
    const transitive = new Set<string>();
    const packageJson = await this.loadPackageJson(projectPath);
    const allPackageDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    const queue = [...componentDeps];
    const visited = new Set<string>();
    const maxDepth = 2; // Conservative - don't go too deep
    let currentDepth = 0;
    
    while (queue.length > 0 && currentDepth < maxDepth) {
      const batchStart = queue.length;
      
      for (let i = 0; i < batchStart; i++) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        
        visited.add(current);
        
        // Only add transitive deps that are essential for the current dependency
        const essentialTransitive = this.getEssentialTransitiveDeps(current, allPackageDeps);
        essentialTransitive.forEach(dep => {
          if (!componentDeps.has(dep)) {
            transitive.add(dep);
            queue.push(dep);
          }
        });
      }
      
      currentDepth++;
    }
    
    return transitive;
  }
  
  private async extractComponentImports(content: string, filePath: string): Promise<Set<string>> {
    // Check cache first
    const cacheKey = `${filePath}:${content.length}`;
    if (this.importCache.has(cacheKey)) {
      return this.importCache.get(cacheKey)!;
    }
    
    const imports = new Set<string>();
    
    // Use faster regex-first approach
    const importPatterns = [
      /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ];
    
    for (const pattern of importPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const source = match[1];
        if (this.isPackageDependency(source)) {
          imports.add(this.getPackageName(source));
        }
      }
    }
    
    // Only use AST parsing if we suspect we missed complex imports
    const hasComplexImports = content.includes('import(') || 
                              content.includes('require.resolve') ||
                              content.includes('await import');
    
    if (hasComplexImports && imports.size === 0) {
      try {
        const ast = parse(content, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'objectRestSpread']
        });
        
        const self = this;
        traverse(ast, {
          ImportDeclaration(path: any) {
            const source = path.node.source.value;
            if (self.isPackageDependency(source)) {
              imports.add(self.getPackageName(source));
            }
          },
          CallExpression(path: any) {
            // Handle dynamic imports
            if (path.node.callee.type === 'Import' || 
                (path.node.callee.type === 'Identifier' && path.node.callee.name === 'require')) {
              const arg = path.node.arguments[0];
              if (arg && arg.type === 'StringLiteral') {
                const source = arg.value;
                if (self.isPackageDependency(source)) {
                  imports.add(self.getPackageName(source));
                }
              }
            }
          }
        });
      } catch (error) {
        // Silent fail - regex already got most imports
      }
    }
    
    // Cache the result
    this.importCache.set(cacheKey, imports);
    
    return imports;
  }
  
  private extractTailwindPluginUsage(content: string): Set<string> {
    const plugins = new Set<string>();
    
    // Animation classes (tailwindcss-animate)
    const animationPatterns = [
      /animate-\w+/g,
      /animation-\w+/g, 
      /duration-\w+/g,
      /delay-\w+/g,
      /ease-\w+/g,
      /fade-in/g,
      /fade-out/g,
      /zoom-in/g,
      /zoom-out/g,
      /slide-in/g,
      /slide-out/g,
      /spin-in/g,
      /spin-out/g
    ];
    
    // Check className attributes and cn() calls
    const classNameMatches = content.match(/className=['"]([^'"]+)['"]/g) || [];
    const cnMatches = content.match(/cn\([^)]*['"]([^'"]+)['"][^)]*\)/g) || [];
    
    const allClassStrings = [...classNameMatches, ...cnMatches].join(' ');
    
    // Check for animation classes
    for (const pattern of animationPatterns) {
      if (pattern.test(allClassStrings)) {
        plugins.add('tailwindcss-animate');
        break;
      }
    }
    
    // Check for forms plugin
    if (/\b(form-|input-|invalid:|valid:|checked:|disabled:)/.test(allClassStrings)) {
      plugins.add('@tailwindcss/forms');
    }
    
    // Check for typography plugin
    if (/\bprose(-\w+)?\b/.test(allClassStrings)) {
      plugins.add('@tailwindcss/typography');
    }
    
    // Check for aspect ratio plugin
    if (/\baspect-\w+/.test(allClassStrings)) {
      plugins.add('@tailwindcss/aspect-ratio');
    }
    
    // Check for container queries plugin
    if (/@container\b/.test(allClassStrings)) {
      plugins.add('@tailwindcss/container-queries');
    }
    
    return plugins;
  }
  
  private async extractConfigDependencies(content: string, filePath: string): Promise<string[]> {
    const deps: string[] = [];
    
    // Look for require() statements (CommonJS)
    const requireMatches = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
    requireMatches.forEach(match => {
      const dep = match.match(/require\(['"]([^'"]+)['"]\)/)?.[1];
      if (dep && this.isPackageDependency(dep)) {
        deps.push(this.getPackageName(dep));
      }
    });
    
    // Look for import statements (ES modules)
    const importMatches = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g) || [];
    importMatches.forEach(match => {
      const source = match.match(/from\s+['"]([^'"]+)['"]/);
      if (source && this.isPackageDependency(source[1])) {
        deps.push(this.getPackageName(source[1]));
      }
    });
    
    return deps;
  }
  
  private getEssentialTransitiveDeps(dependency: string, allDeps: Record<string, string>): string[] {
    // Only include truly essential transitive dependencies
    const essential: string[] = [];
    
    // For React-related packages, include their essential peers
    if (dependency.includes('react') && !dependency.includes('react-dom')) {
      if (allDeps['react-dom']) essential.push('react-dom');
    }
    
    // For Tailwind, include PostCSS
    if (dependency === 'tailwindcss') {
      if (allDeps['postcss']) essential.push('postcss');
      if (allDeps['autoprefixer']) essential.push('autoprefixer');
    }
    
    // For Vite, include its essential plugins
    if (dependency === 'vite') {
      if (allDeps['@vitejs/plugin-react']) essential.push('@vitejs/plugin-react');
    }
    
    return essential;
  }
  
  private async extractImports(filePath: string): Promise<string[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const imports: string[] = [];
    
    try {
      const ast = parse(content, {
        sourceType: 'module',
        plugins: [
          'jsx',
          'typescript',
          'decorators-legacy',
          'classProperties',
          'objectRestSpread',
          'asyncGenerators',
          'functionBind',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'nullishCoalescingOperator',
          'optionalChaining'
        ]
      });
      
      const self = this;
      traverse(ast, {
        ImportDeclaration(path: any) {
          const source = path.node.source.value;
          if (self.isPackageDependency(source)) {
            imports.push(self.getPackageName(source));
          }
        },
        CallExpression(path: any) {
          // Handle dynamic imports and require statements
          if (path.node.callee.type === 'Import' || 
              (path.node.callee.type === 'Identifier' && path.node.callee.name === 'require')) {
            const arg = path.node.arguments[0];
            if (arg && arg.type === 'StringLiteral') {
              const source = arg.value;
              if (self.isPackageDependency(source)) {
                imports.push(self.getPackageName(source));
              }
            }
          }
        }
      });
    } catch (error) {
      console.warn(`Failed to parse ${filePath}:`, error.message);
    }
    
    return imports;
  }
  
  private isPackageDependency(source: string): boolean {
    // Not a relative import
    return !source.startsWith('./') && !source.startsWith('../') && !source.startsWith('/');
  }
  
  private getPackageName(source: string): string {
    // Handle scoped packages like @radix-ui/react-dialog
    if (source.startsWith('@')) {
      const parts = source.split('/');
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : source;
    }
    
    // Handle regular packages that might have sub-paths
    return source.split('/')[0];
  }
  
  private async loadPackageJson(projectPath: string): Promise<any> {
    try {
      const packagePath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packagePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { dependencies: {}, devDependencies: {} };
    }
  }
  
  private isEssentialDependency(dep: string): boolean {
    const essential = [
      'react', 'react-dom', 'typescript', 'vite',
      '@vitejs/plugin-react', 'tailwindcss', 'postcss',
      'autoprefixer', 'tailwindcss-animate', '@tailwindcss/forms',
      '@tailwindcss/typography', '@tailwindcss/aspect-ratio',
      '@tailwindcss/container-queries'
    ];
    return essential.includes(dep) || 
           dep.startsWith('@types/') ||
           dep.includes('eslint') ||
           dep.includes('prettier') ||
           dep.includes('tailwindcss-');  // Keep all tailwind plugins
  }
  
  private isServerSideDependency(dep: string): boolean {
    return this.serverSidePackages.some(pkg => dep.includes(pkg));
  }
  
  private isHeavyDependency(dep: string): boolean {
    return this.heavyPackages.includes(dep);
  }
  
  private generateRecommendations(
    used: Set<string>,
    unused: string[],
    serverSide: string[],
    heavy: string[]
  ): string[] {
    const recommendations: string[] = [];
    
    if (unused.length > 0) {
      recommendations.push(`Remove ${unused.length} unused dependencies: ${unused.slice(0, 5).join(', ')}${unused.length > 5 ? '...' : ''}`);
    }
    
    if (serverSide.length > 0) {
      recommendations.push(`Remove ${serverSide.length} server-side dependencies from client build: ${serverSide.join(', ')}`);
    }
    
    if (heavy.length > 0) {
      recommendations.push(`Consider lighter alternatives for heavy dependencies: ${heavy.join(', ')}`);
    }
    
    // Specific recommendations for common heavy libraries
    if (used.has('framer-motion')) {
      recommendations.push('Consider replacing framer-motion with @react-spring/web or CSS animations');
    }
    
    if (used.has('recharts')) {
      recommendations.push('Consider lighter chart library or remove if charts are unused');
    }
    
    if (used.has('@tanstack/react-query')) {
      recommendations.push('Consider simpler state management if not using complex data fetching');
    }
    
    return recommendations;
  }

  // =============================================
  // ADVANCED AST ANALYSIS ALGORITHMS
  // =============================================

  // Legacy method - kept for compatibility but simplified
  private async buildDependencyGraph(sourceFiles: string[], projectPath: string): Promise<DependencyGraph> {
    return this.buildSimplifiedDependencyGraph(sourceFiles, new Set());
  }

  private async buildNodesAndEdges(ast: any, filePath: string, nodes: Map<string, DependencyNode>, edges: CallGraphEdge[]) {
    // Use simple regex patterns as fallback when traverse fails
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Extract imports using regex
    const importMatches = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g) || [];
    
    importMatches.forEach(importStatement => {
      const match = importStatement.match(/from\s+['"]([^'"]+)['"]/);
      if (match) {
        const dependency = this.getPackageName(match[1]);
        if (this.isPackageDependency(match[1])) {
          this.addNode(nodes, dependency, 'import', filePath);
          this.addEdge(edges, filePath, dependency, 'import', 1);
        }
      }
    });

    // Extract component definitions
    const componentMatches = content.match(/(?:function|const)\s+([A-Z][a-zA-Z0-9]*)\s*[=\(]/g) || [];
    componentMatches.forEach(componentMatch => {
      const match = componentMatch.match(/(?:function|const)\s+([A-Z][a-zA-Z0-9]*)/);
      if (match) {
        this.addNode(nodes, match[1], 'component', filePath);
      }
    });

    // Extract JSX usage
    const jsxMatches = content.match(/<([A-Z][a-zA-Z0-9]*)/g) || [];
    jsxMatches.forEach(jsxMatch => {
      const componentName = jsxMatch.slice(1);
      this.addNode(nodes, componentName, 'component', filePath);
      this.addEdge(edges, filePath, componentName, 'render', 1);
    });

    // Extract function calls
    const callMatches = content.match(/([a-zA-Z][a-zA-Z0-9]*)\s*\(/g) || [];
    callMatches.forEach(callMatch => {
      const funcName = callMatch.slice(0, -1).trim();
      if (funcName.length > 1) {
        this.addEdge(edges, filePath, funcName, 'call', 1);
      }
    });
  }

  private addNode(nodes: Map<string, DependencyNode>, name: string, type: DependencyNode['type'], filePath: string) {
    if (!nodes.has(name)) {
      nodes.set(name, {
        name,
        type,
        usages: new Set([filePath]),
        dependencies: new Set(),
        weight: 1,
        isEntryPoint: filePath.includes('main.tsx') || filePath.includes('App.tsx')
      });
    } else {
      nodes.get(name)!.usages.add(filePath);
      nodes.get(name)!.weight++;
    }
  }

  private addEdge(edges: CallGraphEdge[], from: string, to: string, type: CallGraphEdge['type'], weight: number) {
    edges.push({ from, to, type, weight });
  }

  private async performDataFlowAnalysis(graph: DependencyGraph): Promise<DataFlowAnalysis> {
    // Mark-and-sweep algorithm from entry points
    const reachableFromEntry = this.markReachableNodes(graph);
    
    // Find dead code branches
    const allNodes = new Set(graph.nodes.keys());
    const deadCodeBranches = new Set([...allNodes].filter(node => !reachableFromEntry.has(node)));

    // Identify unused imports (imports with no outgoing edges)
    const unusedImports = new Set<string>();
    const typeOnlyImports = new Set<string>();
    
    for (const [nodeName, node] of graph.nodes) {
      if (node.type === 'import') {
        const hasUsage = graph.edges.some(edge => edge.from === nodeName || edge.to === nodeName);
        if (!hasUsage) {
          // Check if it's type-only by looking for type annotations
          const isTypeOnly = this.isTypeOnlyImport(nodeName);
          if (isTypeOnly) {
            typeOnlyImports.add(nodeName);
          } else {
            unusedImports.add(nodeName);
          }
        }
      }
    }

    // Find transitively unused dependencies
    const transitivelyUnused = this.findTransitivelyUnused(graph, deadCodeBranches);

    return {
      reachableFromEntry,
      deadCodeBranches,
      unusedImports,
      typeOnlyImports,
      transitivelyUnused
    };
  }

  private markReachableNodes(graph: DependencyGraph): Set<string> {
    const reachable = new Set<string>();
    const queue = [...graph.entryPoints];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;

      reachable.add(current);

      // Add all dependencies of current node
      const outgoingEdges = graph.edges.filter(edge => edge.from === current);
      for (const edge of outgoingEdges) {
        if (!reachable.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }

    return reachable;
  }

  private async analyzeComponentDependencies(sourceFiles: string[], graph: DependencyGraph): Promise<ComponentAnalysis> {
    const renderedComponents = new Set<string>();
    const unrenderedComponents = new Set<string>();
    const unusedProps = new Map<string, string[]>();
    const unusedEventHandlers = new Set<string>();
    const unusedStyles = new Set<string>();

    // Find all components that are actually rendered
    for (const edge of graph.edges) {
      if (edge.type === 'render') {
        renderedComponents.add(edge.to);
      }
    }

    // Identify unrendered components
    for (const [nodeName, node] of graph.nodes) {
      if (node.type === 'component' && !renderedComponents.has(nodeName)) {
        unrenderedComponents.add(nodeName);
      }
    }

    // Analyze props and event handlers (simplified)
    for (const file of sourceFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        
        // Find unused props patterns
        const propMatches = content.match(/(\w+):\s*\w+/g) || [];
        const usedProps = content.match(/props\.(\w+)/g) || [];
        
        const definedProps = propMatches.map(p => p.split(':')[0]);
        const actuallyUsedProps = usedProps.map(p => p.split('.')[1]);
        
        const unused = definedProps.filter(prop => !actuallyUsedProps.includes(prop));
        if (unused.length > 0) {
          unusedProps.set(file, unused);
        }

        // Find unused event handlers
        const handlerMatches = content.match(/on[A-Z]\w+/g) || [];
        handlerMatches.forEach(handler => {
          if (!content.includes(`${handler}=`)) {
            unusedEventHandlers.add(handler);
          }
        });

        // Find unused styles
        const classMatches = content.match(/className=['"]([^'"]+)['"]/g) || [];
        classMatches.forEach(classMatch => {
          const classes = classMatch.match(/['"]([^'"]+)['"]/)?.[1]?.split(' ') || [];
          classes.forEach(cls => {
            if (cls && !this.isUsedInCSS(cls, sourceFiles)) {
              unusedStyles.add(cls);
            }
          });
        });

      } catch (error) {
        console.warn(`Failed to analyze component dependencies in ${file}:`, error.message);
      }
    }

    return {
      renderedComponents,
      unrenderedComponents,
      unusedProps,
      unusedEventHandlers,
      unusedStyles
    };
  }

  private async analyzeBundleSplitting(graph: DependencyGraph, componentAnalysis: ComponentAnalysis): Promise<BundleSplitAnalysis> {
    // Find critical path (most frequently used components/imports)
    const usageFrequency = new Map<string, number>();
    for (const [nodeName, node] of graph.nodes) {
      usageFrequency.set(nodeName, node.weight);
    }

    const criticalPath = [...usageFrequency.entries()]
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([name]) => name);

    // Find cohesive clusters (components used together)
    const cohesiveClusters = this.findCohesiveClusters(graph);

    // Find lazy load candidates (rarely used, heavy components)
    const lazyLoadCandidates = [...graph.nodes.entries()]
      .filter(([name, node]) => {
        return node.weight <= 2 && 
               (this.isHeavyDependency(name) || componentAnalysis.unrenderedComponents.has(name));
      })
      .map(([name]) => name);

    // Determine optimal split points
    const splitPoints = new Map<string, number>();
    criticalPath.forEach((name, index) => {
      splitPoints.set(name, index === 0 ? 1 : Math.ceil(index / 3)); // Group into chunks of 3
    });

    // Phase 4: Enhanced clustering recommendations
    const clusterRecommendations = this.generateClusterBasedRecommendations(cohesiveClusters, lazyLoadCandidates);
    
    return {
      criticalPath,
      cohesiveClusters,
      lazyLoadCandidates,
      splitPoints,
      clusterRecommendations // Enhanced Phase 4 output
    };
  }

  // Simplified dependency graph for legacy compatibility
  private async buildSimplifiedDependencyGraph(sourceFiles: string[], usedDeps: Set<string>): Promise<DependencyGraph> {
    const nodes = new Map<string, DependencyNode>();
    const edges: CallGraphEdge[] = [];
    const entryPoints = new Set<string>();

    // Only build graph for dependencies we know are used
    for (const dep of usedDeps) {
      this.addNode(nodes, dep, 'import', 'component-scan');
    }

    // Find entry points
    for (const file of sourceFiles) {
      if (file.includes('main.tsx') || file.includes('App.tsx') || file.includes('/pages/')) {
        entryPoints.add(file);
      }
    }

    return { nodes, edges, entryPoints };
  }
  
  private async performSimplifiedDataFlowAnalysis(graph: DependencyGraph): Promise<DataFlowAnalysis> {
    // Simplified analysis since we already know what's used from component scan
    const reachableFromEntry = new Set(graph.nodes.keys());
    const deadCodeBranches = new Set<string>();
    const unusedImports = new Set<string>();
    const typeOnlyImports = new Set<string>();
    const transitivelyUnused = new Set<string>();

    return {
      reachableFromEntry,
      deadCodeBranches,
      unusedImports,
      typeOnlyImports,
      transitivelyUnused
    };
  }

  // Helper methods
  private findTransitivelyUnused(graph: DependencyGraph, deadBranches: Set<string>): Set<string> {
    const transitivelyUnused = new Set<string>();
    
    for (const deadBranch of deadBranches) {
      const dependents = graph.edges
        .filter(edge => edge.to === deadBranch)
        .map(edge => edge.from);
      
      for (const dependent of dependents) {
        if (deadBranches.has(dependent)) {
          transitivelyUnused.add(dependent);
        }
      }
    }
    
    return transitivelyUnused;
  }

  private findCohesiveClusters(graph: DependencyGraph): string[][] {
    // Phase 4: Advanced dependency clustering based on semantic relationships
    const clusters: string[][] = [];
    
    // 1. UI Component Clusters (RadixUI, Lucide, etc.)
    const uiCluster = this.findSemanticCluster(graph, [
      '@radix-ui', 'lucide-react', '@headlessui', '@heroicons',
      'framer-motion', 'react-spring', 'tailwindcss'
    ], 'UI Components');
    
    // 2. State Management Clusters  
    const stateCluster = this.findSemanticCluster(graph, [
      '@tanstack/react-query', 'zustand', 'redux', '@reduxjs',
      'react-redux', 'swr', 'react-hook-form'
    ], 'State Management');
    
    // 3. Routing & Navigation Clusters
    const routingCluster = this.findSemanticCluster(graph, [
      'wouter', 'react-router', '@reach/router', 
      'next/router', 'gatsby'
    ], 'Routing & Navigation');
    
    // 4. Utility & Helper Clusters
    const utilityCluster = this.findSemanticCluster(graph, [
      'lodash', 'ramda', 'date-fns', 'moment',
      'class-variance-authority', 'clsx', 'classnames'
    ], 'Utilities');
    
    // 5. Data Visualization Clusters
    const dataVizCluster = this.findSemanticCluster(graph, [
      'recharts', 'd3', 'chart.js', 'react-chartjs-2',
      'victory', 'nivo'
    ], 'Data Visualization');
    
    // Add clusters with meaningful content
    [uiCluster, stateCluster, routingCluster, utilityCluster, dataVizCluster]
      .filter(cluster => cluster.length > 1)
      .forEach(cluster => clusters.push(cluster));
    
    // 6. Connected Component Analysis (existing logic)
    const visited = new Set<string>();
    for (const [nodeName] of graph.nodes) {
      if (!visited.has(nodeName) && !this.isInExistingCluster(nodeName, clusters)) {
        const cluster = this.findConnectedComponents(graph, nodeName, visited);
        if (cluster.length > 1) {
          clusters.push(cluster);
        }
      }
    }

    return clusters;
  }
  
  /**
   * Phase 4: Find semantic clusters based on package patterns and relationships
   */
  private findSemanticCluster(graph: DependencyGraph, patterns: string[], clusterName: string): string[] {
    const cluster: string[] = [];
    
    for (const [nodeName] of graph.nodes) {
      if (patterns.some(pattern => nodeName.includes(pattern))) {
        cluster.push(nodeName);
      }
    }
    
    return cluster;
  }
  
  private isInExistingCluster(nodeName: string, clusters: string[][]): boolean {
    return clusters.some(cluster => cluster.includes(nodeName));
  }
  
  /**
   * Phase 4: Generate optimization recommendations based on dependency clusters
   */
  private generateClusterBasedRecommendations(clusters: string[][], lazyLoadCandidates: string[]): any {
    const recommendations = {
      bundleSplitting: [] as any[],
      lazyLoading: [] as any[],
      preloading: [] as any[],
      caching: [] as any[]
    };
    
    // Bundle splitting recommendations based on clusters
    clusters.forEach((cluster, index) => {
      if (cluster.length >= 3) {
        const clusterType = this.identifyClusterType(cluster);
        recommendations.bundleSplitting.push({
          cluster: cluster,
          type: clusterType,
          chunkName: `${clusterType.toLowerCase().replace(/\s+/g, '-')}-vendor`,
          reason: `${cluster.length} related ${clusterType.toLowerCase()} dependencies can be bundled together`,
          priority: cluster.some(dep => this.isHeavyDependency(dep)) ? 'high' : 'medium'
        });
      }
    });
    
    // Lazy loading recommendations
    lazyLoadCandidates.forEach(candidate => {
      const clusterMatch = clusters.find(cluster => cluster.includes(candidate));
      recommendations.lazyLoading.push({
        dependency: candidate,
        cluster: clusterMatch || [candidate],
        reason: this.isHeavyDependency(candidate) 
          ? 'Heavy dependency - good candidate for lazy loading'
          : 'Low usage dependency - can be loaded on-demand',
        estimatedSavings: this.estimateDependencySize(candidate)
      });
    });
    
    // Preloading recommendations for critical clusters
    const criticalClusters = clusters.filter(cluster => 
      cluster.some(dep => dep.includes('react') || dep.includes('core') || dep.includes('@/pages'))
    );
    criticalClusters.forEach(cluster => {
      recommendations.preloading.push({
        cluster: cluster,
        reason: 'Critical path dependencies should be preloaded',
        timing: 'immediate'
      });
    });
    
    // Caching recommendations
    clusters.forEach(cluster => {
      if (cluster.length >= 2 && !cluster.some(dep => dep.startsWith('@/'))) {
        recommendations.caching.push({
          cluster: cluster,
          strategy: 'long-term',
          reason: 'Vendor dependencies rarely change - good for long-term caching'
        });
      }
    });
    
    return recommendations;
  }
  
  private identifyClusterType(cluster: string[]): string {
    if (cluster.some(dep => dep.includes('@radix-ui') || dep.includes('lucide'))) {
      return 'UI Components';
    }
    if (cluster.some(dep => dep.includes('@tanstack') || dep.includes('query'))) {
      return 'State Management';
    }
    if (cluster.some(dep => dep.includes('wouter') || dep.includes('router'))) {
      return 'Routing';
    }
    if (cluster.some(dep => dep.includes('recharts') || dep.includes('chart'))) {
      return 'Data Visualization';
    }
    if (cluster.some(dep => dep.includes('@/'))) {
      return 'Application Code';
    }
    return 'Utilities';
  }
  
  private estimateDependencySize(dependency: string): string {
    // Rough estimates based on common package sizes
    if (dependency.includes('recharts') || dependency.includes('d3')) return '~200KB';
    if (dependency.includes('@tanstack/react-query')) return '~100KB';
    if (dependency.includes('moment')) return '~300KB';
    if (dependency.includes('lodash')) return '~500KB';
    if (dependency.includes('@radix-ui')) return '~50KB';
    return '~25KB';
  }

  private findConnectedComponents(graph: DependencyGraph, startNode: string, visited: Set<string>): string[] {
    const component: string[] = [];
    const queue = [startNode];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      visited.add(current);
      component.push(current);

      // Add connected nodes
      const connected = graph.edges
        .filter(edge => edge.from === current || edge.to === current)
        .map(edge => edge.from === current ? edge.to : edge.from)
        .filter(node => !visited.has(node));

      queue.push(...connected);
    }

    return component;
  }

  private isTypeOnlyImport(nodeName: string): boolean {
    // Heuristic: common type-only patterns
    return nodeName.includes('Type') || 
           nodeName.includes('Interface') || 
           nodeName.endsWith('Props') ||
           nodeName.startsWith('I') && nodeName[1]?.toUpperCase() === nodeName[1];
  }

  private isUsedInCSS(className: string, sourceFiles: string[]): boolean {
    // Simplified: assume all Tailwind classes are used
    return className.includes('text-') || 
           className.includes('bg-') || 
           className.includes('p-') ||
           className.includes('m-') ||
           className.includes('flex') ||
           className.includes('grid');
  }

  private generateAdvancedRecommendations(
    graph: DependencyGraph,
    dataFlow: DataFlowAnalysis,
    components: ComponentAnalysis,
    bundleSplit: BundleSplitAnalysis,
    used: Set<string>,
    unused: string[],
    serverSide: string[],
    heavy: string[]
  ): string[] {
    const recommendations: string[] = [];

    if (unused.length > 0) {
      recommendations.push(`🗑️  Remove ${unused.length} unused dependencies: ${unused.slice(0, 5).join(', ')}${unused.length > 5 ? '...' : ''}`);
    }

    if (dataFlow.deadCodeBranches.size > 0) {
      recommendations.push(`💀 Remove ${dataFlow.deadCodeBranches.size} dead code branches for smaller bundles`);
    }

    if (components.unrenderedComponents.size > 0) {
      recommendations.push(`🎭 Remove ${components.unrenderedComponents.size} unrendered components`);
    }

    if (bundleSplit.lazyLoadCandidates.length > 0) {
      recommendations.push(`⚡ Lazy load ${bundleSplit.lazyLoadCandidates.length} heavy components: ${bundleSplit.lazyLoadCandidates.slice(0, 3).join(', ')}`);
    }

    if (serverSide.length > 0) {
      recommendations.push(`🖥️  Remove ${serverSide.length} server-side dependencies from client build`);
    }

    if (dataFlow.typeOnlyImports.size > 0) {
      recommendations.push(`📝 Convert ${dataFlow.typeOnlyImports.size} imports to type-only imports`);
    }

    if (bundleSplit.criticalPath.length > 3) {
      recommendations.push(`🚀 Split critical path into ${Math.ceil(bundleSplit.criticalPath.length / 3)} chunks for better loading`);
    }

    return recommendations;
  }
}
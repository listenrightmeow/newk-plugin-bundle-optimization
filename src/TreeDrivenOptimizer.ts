import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Tree-driven optimizer that makes optimization decisions based on the actual dependency tree
 * rather than hardcoded logic. If a dependency is in the tree, it stays in the build.
 */
export class TreeDrivenOptimizer {
  
  /**
   * Generate external dependencies dynamically based on tree analysis
   * CRITICAL: Never externalize anything imported in source code
   */
  generateExternalDependencies(analysis: any): string[] {
    const usedDependencies = analysis.usedDependencies || new Set();
    const external: string[] = [];
    
    // SAFE EXTERNAL LIST - Only true build tools and dev plugins
    const safeBuildTools = [
      // Build tools that are never imported in source
      'esbuild', 'webpack', 'rollup', 'terser', 'tsx',
      // TypeScript types that are compile-time only
      '@types/node', '@types/express', '@types/ws', '@types/passport',
      // Dev plugins (never imported in components)
      '@listenrightmeow/newk', '@listenrightmeow/newk-plugin-bundle-optimization',
      '@listenrightmeow/newk-plugin-critical-css', '@listenrightmeow/newk-plugin-image-optimization',
      '@listenrightmeow/newk-plugin-lazy-loading', '@listenrightmeow/newk-plugin-react',
      '@listenrightmeow/newk-plugin-seo', '@listenrightmeow/newk-plugin-social-media',
      '@tailwindcss/vite',
      // Database and server tools
      'drizzle-kit',
    ];
    
    // Only externalize if it's in the safe list AND not used in components
    if (analysis.unusedDependencies) {
      for (const dep of analysis.unusedDependencies) {
        // RULE 1: If it's in the component tree, NEVER externalize
        if (usedDependencies.has(dep)) {
          continue;
        }
        
        // RULE 2: Only externalize if it's in the safe build tools list
        if (safeBuildTools.includes(dep) || dep.startsWith('@types/')) {
          external.push(dep);
        }
      }
    }
    
    // VALIDATION: Ensure we're not externalizing any imported dependencies
    this.validateExternalDependencies(external, usedDependencies);
    
    return external;
  }
  
  /**
   * Validate that we're not externalizing any dependencies that are imported in code
   */
  private validateExternalDependencies(external: string[], usedDependencies: Set<string>): void {
    const problematicExternals = external.filter(dep => usedDependencies.has(dep));
    
    if (problematicExternals.length > 0) {
      console.error('🚨 CRITICAL ERROR: Attempting to externalize imported dependencies!');
      problematicExternals.forEach(dep => {
        console.error(`   ❌ ${dep} is imported in source code but marked as external`);
      });
      throw new Error(`Cannot externalize imported dependencies: ${problematicExternals.join(', ')}`);
    }
    
    // Validation passed silently
  }
  
  /**
   * Generate moduleSideEffects function dynamically based on tree
   */
  generateModuleSideEffectsLogic(analysis: any): string {
    // MAXIMUM AGGRESSION: Only preserve our app code
    // Let Rollup tree-shake EVERYTHING from node_modules
    const preserveList: string[] = [
      // Only our app source
      "id.includes('/client/src/')",
      // Only our app CSS (not from node_modules)
      "(id.includes('.css') && !id.includes('node_modules'))"
    ];
    
    const preserveConditions = preserveList.length > 0 ? 
      `if (${preserveList.join(' || ')}) return true;` : '';
    
    return `(id) => {
          ${preserveConditions}
          return false;
        }`;
  }
  
  /**
   * Generate manual chunks based on actual dependency clusters from tree
   * SIMPLIFIED: Fewer chunks = better performance for small-medium apps
   */
  generateManualChunks(analysis: any): string {
    // SIMPLE STRATEGY: Just 2 chunks maximum
    // 1. vendor (all node_modules)  
    // 2. app (all application code)
    
    return `(id) => {
          if (id.includes('node_modules')) {
            // Single vendor chunk for all dependencies
            return 'vendor';
          }
          
          // Single app chunk for all application code
          return undefined;
        }`;
  }
  
  /**
   * Generate tree-shaking configuration based on dependency graph
   */
  generateTreeShakeConfig(analysis: any): string {
    const usedDependencies = analysis.usedDependencies || new Set();
    const componentAnalysis = analysis.componentAnalysis || {};
    
    // ALWAYS be aggressive - we have a good dependency tree
    const preset = 'smallest'; // Maximum tree-shaking
    
    return `{
        moduleSideEffects: ${this.generateModuleSideEffectsLogic(analysis)},
        propertyReadSideEffects: false, // Aggressive - assume no property read side effects
        unknownGlobalSideEffects: false, // Aggressive - assume no unknown global side effects
        preset: '${preset}' // Maximum tree-shaking
      }`;
  }
  
  /**
   * Determine if a dependency should be removed from imports
   * based on tree presence rather than hardcoded rules
   */
  shouldRemoveDependency(dependency: string, analysis: any): boolean {
    const usedDependencies = analysis.usedDependencies || new Set();
    
    // Primary rule: If it's in the component tree, DON'T remove it
    if (usedDependencies.has(dependency)) {
      return false;
    }
    
    // Secondary rule: If it's in unused list and not in tree, remove it
    if (analysis.unusedDependencies?.includes(dependency)) {
      return true;
    }
    
    // Default: Don't remove (conservative)
    return false;
  }
  
  /**
   * Generate import removal patterns dynamically
   */
  generateImportRemovalPatterns(analysis: any): { shouldRemove: (dep: string) => boolean } {
    return {
      shouldRemove: (dep: string) => this.shouldRemoveDependency(dep, analysis)
    };
  }
  
  /**
   * Generate component removal logic based on actual component tree
   */
  shouldRemoveComponent(componentName: string, analysis: any): boolean {
    const componentAnalysis = analysis.componentAnalysis || {};
    
    // If component is in unrendered list, it can be removed
    if (componentAnalysis.unrenderedComponents?.has(componentName)) {
      return true;
    }
    
    // If component is in rendered list, keep it
    if (componentAnalysis.renderedComponents?.has(componentName)) {
      return false;
    }
    
    // Default: Don't remove (conservative)
    return false;
  }
  
  /**
   * Generate complete dynamic build configuration
   */
  generateDynamicBuildConfig(analysis: any, safeMode: boolean = false): string {
    const external = this.generateExternalDependencies(analysis);
    const externalList = JSON.stringify(external);
    
    return `{
    outDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    minify: "terser",
    cssMinify: "lightningcss",
    reportCompressedSize: false,
    
    rollupOptions: {
      external: ${externalList},
      treeshake: ${this.generateTreeShakeConfig(analysis)},
      output: {
        manualChunks: ${this.generateManualChunks(analysis)},
        entryFileNames: "[name]-[hash:8].js",
        chunkFileNames: "[name]-[hash:8].js",
        assetFileNames: (assetInfo) => {
          const extType = assetInfo.name.split('.').pop();
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType)) {
            return \`img/[name]-[hash:8].[ext]\`;
          }
          if (/css/i.test(extType)) {
            return \`css/[name]-[hash:8].[ext]\`;
          }
          return \`assets/[name]-[hash:8].[ext]\`;
        },
        compact: true,
        generatedCode: {
          preset: 'es2015',
          constBindings: true
        }
      }
    },
    
    terserOptions: ${safeMode ? this.getSafeTerserOptions() : this.getAggressiveTerserOptions()},
    
    cssCodeSplit: false,
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 30,
    
    experimental: {
      renderBuiltUrl: (filename: string) => {
        return \`/\${filename}\`;
      }
    }
  }`;
  }
  
  private getSafeTerserOptions(): string {
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
  
  private getAggressiveTerserOptions(): string {
    return `{
      compress: {
        arguments: true,
        booleans_as_integers: true,
        drop_console: true,
        drop_debugger: true,
        ecma: 2020,
        hoist_funs: true,
        hoist_props: true,
        hoist_vars: true,
        inline: 3,
        join_vars: true,
        loops: true,
        negate_iife: true,
        passes: 5,
        properties: true,
        pure_funcs: [
          "console.log", "console.info", "console.debug", "console.warn", 
          "console.error", "console.trace", "console.time", "console.timeEnd"
        ],
        pure_getters: true,
        reduce_funcs: true,
        reduce_vars: true,
        sequences: true,
        side_effects: false,
        switches: true,
        typeofs: false,
        unsafe: true,
        unsafe_arrows: true,
        unsafe_comps: true,
        unsafe_Function: true,
        unsafe_math: true,
        unsafe_symbols: true,
        unsafe_methods: true,
        unsafe_proto: true,
        unsafe_regexp: true,
        unsafe_undefined: true,
        unused: true
      },
      mangle: {
        eval: true,
        keep_classnames: false,
        keep_fnames: false,
        module: true,
        properties: {
          regex: /^_/
        },
        safari10: true,
        toplevel: true
      },
      format: {
        ascii_only: true,
        comments: false,
        ecma: 2020,
        webkit: true
      },
      ecma: 2020,
      module: true,
      toplevel: true
    }`;
  }
}
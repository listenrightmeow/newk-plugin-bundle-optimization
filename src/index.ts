// import { NewkOptimizationPlugin } from '@listenrightmeow/newk';
import { BundleOptimizationPlugin } from './BundleOptimizationPlugin.js';

// Export new nuclear optimization capabilities
export { NuclearOptimizer, NuclearResult, NuclearConfig } from './NuclearOptimizer.js';

const plugin: any = {
  metadata: {
    name: '@listenrightmeow/newk-plugin-bundle-optimization',
    version: '1.0.0',
    description: 'Bundle optimization with AST analysis, unused dependency removal, and intelligent code splitting',
    author: '@listenrightmeow',
    expectedImprovement: '30-50% bundle size reduction with optimal code splitting'
  },
  optimization: new BundleOptimizationPlugin(),
  
  async onLoad() {
    console.debug('Bundle optimization plugin loaded');
  },
  
  async onUnload() {
    console.debug('Bundle optimization plugin unloaded');
  }
};

export default plugin;
export { plugin };
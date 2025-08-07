import * as fs from 'fs/promises';
import * as path from 'path';

export class PackageJsonManager {
  async optimize(packageJsonPath: string, analysis: any): Promise<void> {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    const originalSize = JSON.stringify(packageJson).length;
    const removedDependencies: string[] = [];
    
    // Create backup
    await fs.writeFile(`${packageJsonPath}.backup`, JSON.stringify(packageJson, null, 2));
    
    // Remove unused dependencies
    if (packageJson.dependencies) {
      for (const dep of analysis.unusedDependencies) {
        if (packageJson.dependencies[dep]) {
          delete packageJson.dependencies[dep];
          removedDependencies.push(dep);
          console.log(`Removed unused dependency: ${dep}`);
        }
      }
    }
    
    // Remove server-side dependencies
    if (packageJson.dependencies) {
      for (const dep of analysis.serverSideDependencies) {
        if (packageJson.dependencies[dep]) {
          delete packageJson.dependencies[dep];
          removedDependencies.push(dep);
          console.log(`Removed server-side dependency: ${dep}`);
        }
      }
    }
    
    // Note: We don't touch devDependencies as they don't affect bundle size
    // and could be part of the developer's workflow
    
    // Remove server-related scripts
    if (packageJson.scripts) {
      const serverScripts = ['db:push', 'db:migrate', 'db:seed'];
      for (const script of serverScripts) {
        if (packageJson.scripts[script]) {
          delete packageJson.scripts[script];
          console.log(`Removed server script: ${script}`);
        }
      }
    }
    
    // Add optimization-focused scripts
    if (!packageJson.scripts['build:analyze']) {
      packageJson.scripts['build:analyze'] = 'vite build --mode=analyze';
    }
    
    // Write optimized package.json
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    // Create manifest of removed dependencies
    if (removedDependencies.length > 0) {
      const projectRoot = path.dirname(packageJsonPath);
      const manifest = {
        timestamp: new Date().toISOString(),
        removedDependencies: removedDependencies.sort(),
        totalRemoved: removedDependencies.length,
        note: 'These dependencies were removed from package.json during bundle optimization. A backup was created at package.json.backup'
      };
      
      // Write report to .newk directory if it exists, otherwise main directory
      const newkDir = path.join(projectRoot, '.newk');
      const reportDir = await fs.access(newkDir).then(() => newkDir, () => projectRoot);
      
      await fs.writeFile(
        path.join(reportDir, 'removed-dependencies.json'),
        JSON.stringify(manifest, null, 2)
      );
      
      const reportLocation = reportDir === newkDir ? '.newk/removed-dependencies.json' : 'removed-dependencies.json';
      console.log(`\n📋 Created manifest of ${removedDependencies.length} removed dependencies at ${reportLocation}`);
    }
    
    const newSize = JSON.stringify(packageJson).length;
    const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(1);
    console.log(`Package.json optimized: ${reduction}% reduction in size`);
  }
}
import * as path from 'path';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';

/**
 * Wrapper around DependencyAnalyzer that runs it in an isolated worker process
 * This prevents Babel module conflicts while keeping the sophisticated analysis
 */
export class IsolatedDependencyAnalyzer {
  private workerPath: string;

  constructor() {
    // Use a CommonJS worker to run the analysis in isolation
    this.workerPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'dependency-analyzer-worker.cjs');
  }

  async analyze(projectPath: string): Promise<any> {
    return new Promise(async (resolve, reject) => {
      // Ensure worker exists
      try {
        await this.ensureWorkerExists();
      } catch (error) {
        reject(new Error(`Failed to create worker: ${error.message}`));
        return;
      }

      const worker = spawn('node', [this.workerPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let output = '';
      let error = '';
      
      worker.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      worker.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      worker.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Analysis failed: ${error}`));
        } else {
          try {
            // Extract JSON from console output - look for the actual JSON result
            const lines = output.split('\n');
            let jsonLine = '';
            
            // Find the line that starts with { and looks like JSON
            for (const line of lines) {
              if (line.trim().startsWith('{') && line.includes('"success"')) {
                jsonLine = line.trim();
                break;
              }
            }
            
            if (!jsonLine) {
              throw new Error('No JSON result found in worker output');
            }
            
            const result = JSON.parse(jsonLine);
            if (result.success) {
              // Convert arrays back to Sets for compatibility
              resolve({
                ...result,
                usedDependencies: new Set(result.usedDependencies),
                dataFlowAnalysis: result.dataFlowAnalysis ? {
                  ...result.dataFlowAnalysis,
                  deadCodeBranches: new Set(result.dataFlowAnalysis.deadCodeBranches),
                  unusedImports: result.dataFlowAnalysis.unusedImports
                } : undefined,
                componentAnalysis: result.componentAnalysis ? {
                  ...result.componentAnalysis,
                  renderedComponents: new Set(result.componentAnalysis.renderedComponents),
                  unrenderedComponents: new Set(result.componentAnalysis.unrenderedComponents)
                } : undefined
              });
            } else {
              reject(new Error(result.error));
            }
          } catch (e) {
            reject(new Error(`Failed to parse analysis result: ${e.message}. Output: ${output.slice(0, 500)}...`));
          }
        }
      });
      
      // Send the project path to analyze
      worker.stdin.write(JSON.stringify({ projectPath }));
      worker.stdin.end();
    });
  }

  private async ensureWorkerExists(): Promise<void> {
    // Check if worker exists in dist
    let finalPath = this.workerPath;
    try {
      await fs.access(finalPath);
      return;
    } catch {
      // Try src directory
      finalPath = this.workerPath.replace('/dist/', '/src/');
      try {
        await fs.access(finalPath);
        this.workerPath = finalPath;
        return;
      } catch {
        // Create the worker file
        await this.createWorkerFile();
      }
    }
  }

  private async createWorkerFile(): Promise<void> {
    const workerContent = `#!/usr/bin/env node

// Worker process that runs DependencyAnalyzer in isolation
// This prevents the "Cannot redefine property: Hub" error

const fs = require('fs').promises;
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const glob = require('fast-glob');

${await fs.readFile(path.join(path.dirname(new URL(import.meta.url).pathname), 'DependencyAnalyzer.js'), 'utf-8')}

// Read input from stdin
let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', async () => {
  try {
    const { projectPath } = JSON.parse(input);
    const analyzer = new DependencyAnalyzer();
    const result = await analyzer.analyze(projectPath);
    
    // Convert Sets to Arrays for JSON serialization
    const serializable = {
      ...result,
      usedDependencies: Array.from(result.usedDependencies),
      dataFlowAnalysis: result.dataFlowAnalysis ? {
        ...result.dataFlowAnalysis,
        deadCodeBranches: Array.from(result.dataFlowAnalysis.deadCodeBranches),
        unusedImports: Array.from(result.dataFlowAnalysis.unusedImports)
      } : result.dataFlowAnalysis,
      componentAnalysis: result.componentAnalysis ? {
        ...result.componentAnalysis,
        renderedComponents: Array.from(result.componentAnalysis.renderedComponents),
        unrenderedComponents: Array.from(result.componentAnalysis.unrenderedComponents)
      } : result.componentAnalysis
    };
    
    // Send successful result
    process.stdout.write(JSON.stringify({
      success: true,
      ...serializable
    }));
  } catch (error) {
    // Send error result
    process.stdout.write(JSON.stringify({
      success: false,
      error: error.message
    }));
  }
});`;

    await fs.writeFile(this.workerPath, workerContent, { mode: 0o755 });
  }
}
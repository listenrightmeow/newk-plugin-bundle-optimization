#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const glob = require('fast-glob');

// Run the original TypeScript DependencyAnalyzer in this isolated process
// This requires the DependencyAnalyzer to be compiled first

let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', async () => {
  try {
    const { projectPath } = JSON.parse(input);
    
    // Dynamically import the compiled DependencyAnalyzer (ES module)
    const analyzerPath = path.join(__dirname, 'DependencyAnalyzer.js');
    const analyzerModule = await import(analyzerPath);
    const { DependencyAnalyzer } = analyzerModule;
    
    const analyzer = new DependencyAnalyzer();
    const result = await analyzer.analyze(projectPath);
    
    // Convert Sets to Arrays for JSON serialization
    const serializable = {
      ...result,
      usedDependencies: Array.from(result.usedDependencies),
      dataFlowAnalysis: result.dataFlowAnalysis ? {
        ...result.dataFlowAnalysis,
        deadCodeBranches: Array.from(result.dataFlowAnalysis.deadCodeBranches || []),
        unusedImports: Array.from(result.dataFlowAnalysis.unusedImports || []),
        reachableFromEntry: Array.from(result.dataFlowAnalysis.reachableFromEntry || []),
        typeOnlyImports: Array.from(result.dataFlowAnalysis.typeOnlyImports || []),
        transitivelyUnused: Array.from(result.dataFlowAnalysis.transitivelyUnused || [])
      } : result.dataFlowAnalysis,
      componentAnalysis: result.componentAnalysis ? {
        ...result.componentAnalysis,
        renderedComponents: Array.from(result.componentAnalysis.renderedComponents || []),
        unrenderedComponents: Array.from(result.componentAnalysis.unrenderedComponents || [])
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
      error: error.message,
      stack: error.stack
    }));
  }
});
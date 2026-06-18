#!/usr/bin/env node

/**
 * Script to add Nunito font family to all text styles in the app
 * 
 * This script searches for StyleSheet.create() calls and adds fontFamily
 * to text-related styles that don't already have one.
 * 
 * Usage: node scripts/add-nunito-fonts.js
 */

const fs = require('fs');
const path = require('path');

// Files to skip
const SKIP_FILES = [
  'DeveloperCoachingDashboard.tsx',
  'DeveloperMode.tsx',
  'DeveloperRegeneratePlan.tsx',
  'DeveloperRegenerateHypothesis.tsx',
  'DeveloperCoachEditPlan.tsx',
  'ThemedText.tsx', // Already updated
  'ChoosePlanAndPricing.tsx', // Already updated
  'OnboardOverviewInfo.tsx', // Already updated
];

// Text style properties that indicate a text style
const TEXT_STYLE_INDICATORS = [
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'color',
  'letterSpacing',
];

function shouldSkipFile(filename) {
  return SKIP_FILES.some(skip => filename.includes(skip));
}

function hasTextStyleIndicators(styleContent) {
  return TEXT_STYLE_INDICATORS.some(indicator => 
    styleContent.includes(indicator)
  );
}

function addFontFamilyToStyles(content, filename) {
  // Check if file already imports Typography
  const hasTypographyImport = content.includes("from '../constants/Typography'") ||
                               content.includes("from '@/constants/Typography'");
  
  let updatedContent = content;
  
  // Add Typography import if not present
  if (!hasTypographyImport && content.includes('StyleSheet')) {
    // Find the last import statement
    const importRegex = /import\s+.*?from\s+['"].*?['"];?\n/g;
    const imports = content.match(importRegex);
    if (imports && imports.length > 0) {
      const lastImport = imports[imports.length - 1];
      const importIndex = content.lastIndexOf(lastImport);
      const afterImport = importIndex + lastImport.length;
      
      updatedContent = 
        content.slice(0, afterImport) +
        "import { Typography } from '../constants/Typography';\n" +
        content.slice(afterImport);
    }
  }
  
  // Find all style objects and add fontFamily where appropriate
  // This is a simplified approach - in production you'd want more sophisticated parsing
  const styleRegex = /(\w+):\s*\{([^}]+)\}/g;
  
  updatedContent = updatedContent.replace(styleRegex, (match, styleName, styleContent) => {
    // Skip if already has fontFamily
    if (styleContent.includes('fontFamily')) {
      return match;
    }
    
    // Check if this looks like a text style
    if (!hasTextStyleIndicators(styleContent)) {
      return match;
    }
    
    // Determine which font variant to use based on fontWeight
    let fontFamily = 'Typography.fontFamily.regular';
    if (styleContent.includes("fontWeight: 'bold'") || styleContent.includes('fontWeight: "bold"')) {
      fontFamily = 'Typography.fontFamily.bold';
    } else if (styleContent.includes("fontWeight: '600'") || styleContent.includes('fontWeight: "600"')) {
      fontFamily = 'Typography.fontFamily.semiBold';
    }
    
    // Add fontFamily after fontSize if present, otherwise at the beginning
    if (styleContent.includes('fontSize:')) {
      return match.replace(/fontSize:\s*\d+,?/, (fontSizeMatch) => {
        return fontSizeMatch + `\n    fontFamily: ${fontFamily},`;
      });
    } else {
      // Add at the beginning of the style object
      return `${styleName}: {\n    fontFamily: ${fontFamily},${styleContent}}`;
    }
  });
  
  return updatedContent;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  
  if (shouldSkipFile(filename)) {
    console.log(`Skipping ${filename}`);
    return;
  }
  
  // Skip if file doesn't use StyleSheet
  if (!content.includes('StyleSheet')) {
    return;
  }
  
  const updatedContent = addFontFamilyToStyles(content, filename);
  
  if (updatedContent !== content) {
    fs.writeFileSync(filePath, updatedContent, 'utf8');
    console.log(`Updated ${filename}`);
  }
}

function processDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);
  
  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      processFile(filePath);
    }
  });
}

// Main execution
const componentsDir = path.join(__dirname, '..', 'components');
console.log('Adding Nunito fonts to components...');
processDirectory(componentsDir);
console.log('Done!');


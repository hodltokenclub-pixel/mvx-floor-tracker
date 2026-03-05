#!/usr/bin/env node

// Simple wrapper to run tracker.js
// This is needed for hosting platforms that expect index.js as the entry point

console.log('MVX Floor Tracker - Starting via index.js wrapper...');
console.log('Current directory:', __dirname);
console.log('Node version:', process.version);

// Import and run the main tracker
require('./tracker.js');

console.log('Tracker started successfully via index.js wrapper');
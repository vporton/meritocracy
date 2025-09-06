#!/usr/bin/env node

/**
 * OAuth Configuration Debug Script
 * 
 * This script helps diagnose common OAuth configuration issues
 * that can cause "bad_verification_code" errors
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 OAuth Configuration Debug Tool\n');

// Check backend .env file
const backendEnvPath = path.join(__dirname, 'backend', '.env');
const backendEnvExamplePath = path.join(__dirname, 'backend', 'env.example');

console.log('📁 Backend Configuration:');
if (fs.existsSync(backendEnvPath)) {
  console.log('✅ backend/.env file exists');
  const backendEnv = fs.readFileSync(backendEnvPath, 'utf8');
  
  // Check required GitHub variables
  const requiredBackendVars = [
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET', 
    'FRONTEND_URL'
  ];
  
  requiredBackendVars.forEach(varName => {
    if (backendEnv.includes(`${varName}=`) && !backendEnv.includes(`${varName}=your-`)) {
      console.log(`✅ ${varName} is configured`);
    } else {
      console.log(`❌ ${varName} is missing or not configured`);
    }
  });
  
  // Check FRONTEND_URL value
  const frontendUrlMatch = backendEnv.match(/FRONTEND_URL=(.+)/);
  if (frontendUrlMatch) {
    const frontendUrl = frontendUrlMatch[1].trim();
    console.log(`📍 FRONTEND_URL: ${frontendUrl}`);
    if (frontendUrl === 'http://localhost:5173') {
      console.log('✅ FRONTEND_URL is set to default development URL');
    } else {
      console.log('⚠️  FRONTEND_URL is custom - ensure it matches your frontend server');
    }
  }
} else {
  console.log('❌ backend/.env file not found');
  console.log('📋 Copy backend/env.example to backend/.env and configure OAuth credentials');
}

// Check frontend .env file
const frontendEnvPath = path.join(__dirname, 'frontend', '.env');
const frontendEnvExamplePath = path.join(__dirname, 'frontend', 'env.example');

console.log('\n📁 Frontend Configuration:');
if (fs.existsSync(frontendEnvPath)) {
  console.log('✅ frontend/.env file exists');
  const frontendEnv = fs.readFileSync(frontendEnvPath, 'utf8');
  
  // Check required GitHub variables
  const requiredFrontendVars = [
    'VITE_GITHUB_CLIENT_ID',
    'VITE_GITHUB_REDIRECT_URI'
  ];
  
  requiredFrontendVars.forEach(varName => {
    if (frontendEnv.includes(`${varName}=`) && !frontendEnv.includes(`${varName}=your-`)) {
      console.log(`✅ ${varName} is configured`);
    } else {
      console.log(`❌ ${varName} is missing or not configured`);
    }
  });
  
  // Check redirect URI value
  const redirectUriMatch = frontendEnv.match(/VITE_GITHUB_REDIRECT_URI=(.+)/);
  if (redirectUriMatch) {
    const redirectUri = redirectUriMatch[1].trim();
    console.log(`📍 GitHub Redirect URI: ${redirectUri}`);
    if (redirectUri === 'http://localhost:5173/auth/github/callback') {
      console.log('✅ Redirect URI is set to default development URL');
    } else {
      console.log('⚠️  Custom redirect URI - ensure it matches your GitHub OAuth App settings');
    }
  }
} else {
  console.log('❌ frontend/.env file not found');
  console.log('📋 Copy frontend/env.example to frontend/.env and configure OAuth credentials');
}

console.log('\n🔧 Common Solutions for "bad_verification_code" error:');
console.log('1. Ensure GitHub OAuth App callback URL matches redirect URI exactly');
console.log('2. Check that both frontend and backend .env files are configured');
console.log('3. Verify GITHUB_CLIENT_ID matches between frontend and backend');
console.log('4. Ensure GITHUB_CLIENT_SECRET is correctly set in backend');
console.log('5. Try clearing browser cache and cookies');
console.log('6. Make sure OAuth code isn\'t expired (10 min limit)');

console.log('\n📚 GitHub OAuth App Settings:');
console.log('Homepage URL: http://localhost:5173');
console.log('Authorization callback URL: http://localhost:5173/auth/github/callback');

console.log('\n🚀 Next Steps:');
console.log('1. Fix any ❌ issues shown above');
console.log('2. Restart backend server: cd backend && npm run dev');
console.log('3. Restart frontend server: cd frontend && npm run dev');
console.log('4. Try GitHub OAuth login again');
console.log('5. Check backend console for detailed error logs');

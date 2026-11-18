// Автотесты Electron-приложения (Playwright _electron). Каждый тест работает с временной папкой данных.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
  globalSetup: require.resolve('./tests/global-setup.js'),
  projects: [
    { name: 'app', testIgnore: [/packaged\.spec\.js/, /[\\/]unit[\\/]/] },   // tests/unit — модульные тесты node --test
    { name: 'packaged', testMatch: /packaged\.spec\.js/ }
  ]
});

module.exports = {
  preset: 'react-native',
  haste: {defaultPlatform: 'android', platforms: ['android', 'native']},
  // Pure logic tests under test/ run in the workspace's Vitest suite.
  testMatch: ['<rootDir>/__tests__/**/*.test.[jt]s?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-image-picker|react-native-webview)/)',
  ],
};

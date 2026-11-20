/**
 * Vitest covers the shared packages and pure mobile modules.
 * The RN app has its own jest setup (apps/mobile/jest.config.js).
 * Plain .cjs on purpose: importable by vitest without a local install.
 */
module.exports = {
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/mobile/test/**/*.test.ts'],
  },
};

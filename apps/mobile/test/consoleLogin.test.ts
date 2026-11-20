import {describe, expect, it} from 'vitest';
import {observeKimiLogin} from '../src/consoleLogin';

describe('Kimi console login observation', () => {
  it('recognizes login and device pages on the official hosts', () => {
    expect(observeKimiLogin('https://code-rc.kimi.com/login?from=mobile')).toBe('logged-out');
    expect(observeKimiLogin('https://code-rc.kimi.ai/devices/test/session')).toBe('logged-in');
  });

  it('ignores surrounding URLs and strings that only mention a login path', () => {
    for (const url of [
      '',
      'about:blank',
      'https://example.test/login',
      'https://code-rc.kimi.com.example.test/login',
      'https://code-rc.kimi.com@other.test/login',
      'http://code-rc.kimi.com/login',
      'https://code-rc.kimi.com/help?next=/login',
      'https://code-rc.kimi.com/devices/',
    ]) {
      expect(observeKimiLogin(url)).toBeUndefined();
    }
  });
});

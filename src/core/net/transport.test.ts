import { describe, expect, it } from 'vitest';
import {
  apiPathOf,
  apiUrl,
  apiVersionSegment,
  hasApiPath,
  joinApiUrl,
  stripApiPath,
  withApiPrefix,
} from './transport';

/* Base URL 正規化：欄位與預設值只填服務位址，/v1 這類版本段落一律在組 URL 時才補，
   使用者自己填了路徑就以他填的為準，而且不能補成 /v1/v1。 */
describe('base URL normalization', () => {
  it('reads the path part of a URL', () => {
    expect(apiPathOf('https://api.openai.com')).toBe('');
    expect(apiPathOf('https://api.openai.com/v1')).toBe('/v1');
    expect(apiPathOf('https://api.openai.com/v1/')).toBe('/v1/');
    expect(apiPathOf('https://relay.example/api/v1?k=1')).toBe('/api/v1');
    expect(apiPathOf('http://127.0.0.1:11434/v1')).toBe('/v1');
    // 沒帶 scheme 的寫法（使用者常直接貼 127.0.0.1:11434/v1）
    expect(apiPathOf('127.0.0.1:11434/v1')).toBe('/v1');
    expect(apiPathOf('localhost:11434')).toBe('');
    expect(apiPathOf('')).toBe('');
  });

  it('treats a bare trailing slash as "no path"', () => {
    expect(hasApiPath('https://api.openai.com')).toBe(false);
    expect(hasApiPath('https://api.openai.com/')).toBe(false);
    expect(hasApiPath('https://api.openai.com/v1')).toBe(true);
    expect(hasApiPath('https://relay.example/api')).toBe(true);
  });

  it('detects only version-shaped trailing segments', () => {
    expect(apiVersionSegment('https://api.openai.com/v1')).toBe('/v1');
    expect(apiVersionSegment('https://generativelanguage.googleapis.com/v1beta')).toBe('/v1beta');
    expect(apiVersionSegment('https://relay.example/api/v2')).toBe('/v2');
    expect(apiVersionSegment('https://relay.example/api')).toBe('');
    expect(apiVersionSegment('https://api.openai.com')).toBe('');
  });

  it('strips the path back to scheme + host', () => {
    expect(stripApiPath('https://api.openai.com/v1')).toBe('https://api.openai.com');
    expect(stripApiPath('https://relay.example/api/v1/')).toBe('https://relay.example');
    expect(stripApiPath('127.0.0.1:11434/v1')).toBe('127.0.0.1:11434');
    expect(stripApiPath('https://api.openai.com')).toBe('https://api.openai.com');
  });

  it('appends the API prefix only when the address has no path', () => {
    expect(withApiPrefix('https://api.openai.com', '/v1')).toBe('https://api.openai.com/v1');
    expect(withApiPrefix('https://api.openai.com/', '/v1')).toBe('https://api.openai.com/v1');
    // 使用者已自帶路徑：原樣保留，不覆蓋也不重複
    expect(withApiPrefix('https://api.openai.com/v1', '/v1')).toBe('https://api.openai.com/v1');
    expect(withApiPrefix('https://relay.example/api', '/v1')).toBe('https://relay.example/api');
    expect(withApiPrefix('https://relay.example/v2', '/v1')).toBe('https://relay.example/v2');
    // 沒有前綴（例如本地 SD WebUI）或空位址時不做任何事
    expect(withApiPrefix('http://127.0.0.1:7860', '')).toBe('http://127.0.0.1:7860');
    expect(withApiPrefix('', '/v1')).toBe('');
  });

  it('never produces a duplicated version segment', () => {
    expect(joinApiUrl('https://api.openai.com/v1', '/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(joinApiUrl('https://api.openai.com', '/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    // 位址帶的是 /v1beta，路徑帶 /v1 時屬於不同意義，不該被吃掉
    expect(joinApiUrl('https://generativelanguage.googleapis.com/v1beta', '/v1/models')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/v1/models',
    );
    expect(joinApiUrl('https://relay.example/api/', 'models')).toBe('https://relay.example/api/models');
  });

  it('combines prefix and path in one call', () => {
    expect(apiUrl('https://api.openai.com', '/v1', '/images/generations')).toBe(
      'https://api.openai.com/v1/images/generations',
    );
    expect(apiUrl('https://relay.example', '/v1', '/v1/images/generations')).toBe(
      'https://relay.example/v1/images/generations',
    );
    expect(apiUrl('https://api.openai.com/v1', '/v1', '/models')).toBe(
      'https://api.openai.com/v1/models',
    );
  });
});

/**
 * ai-config.js - Centralized AI Engine Configuration & Model Resolution
 * Offline-first, zero runtime CDN, pure vanilla JS (UMD).
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    const config = factory();
    root.AIConfig = config;
    root.MYGYM_AI_CONFIG = config;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const CSP_ALLOWED_HOSTS = [
    'generativelanguage.googleapis.com',
    'api.openai.com',
    'api.groq.com',
    'openrouter.ai',
    'api.deepseek.com',
    'api.together.xyz'
  ];

  const RETIRED_MODEL_MIGRATIONS = {
    'llama3-70b-8192': 'llama-3.3-70b-versatile',
    'llama3-8b-8192': 'llama-3.1-8b-instant',
    'gemma2-9b-it': 'llama-3.1-8b-instant',
    'mixtral-8x7b-32768': 'llama-3.3-70b-versatile',
    'gemini-1.5-flash': 'gemini-2.0-flash',
    'gemini-1.5-flash-latest': 'gemini-2.0-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro',
    'gemini-1.5-pro-latest': 'gemini-2.5-pro'
  };

  const AI_PROVIDERS = {
    groq: {
      id: 'groq',
      name: 'Groq (Free & Ultra-Fast)',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      defaultModel: 'llama-3.3-70b-versatile',
      fallbackModel: 'llama-3.1-8b-instant',
      keyPrefix: 'gsk_',
      keyPlaceholder: 'gsk_...',
      keyLink: 'https://console.groq.com/keys',
      models: [
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' }
      ]
    },
    openai: {
      id: 'openai',
      name: 'OpenAI (ChatGPT)',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      modelsEndpoint: 'https://api.openai.com/v1/models',
      defaultModel: 'gpt-4o-mini',
      fallbackModel: 'gpt-4o',
      keyPrefix: 'sk-',
      keyPlaceholder: 'sk-...',
      keyLink: 'https://platform.openai.com/api-keys',
      models: [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4o', name: 'GPT-4o' }
      ]
    },
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter (Free Tier)',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      modelsEndpoint: 'https://openrouter.ai/api/v1/models',
      defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
      fallbackModel: 'meta-llama/llama-3.3-70b-instruct:free',
      keyPrefix: 'sk-or-',
      keyPlaceholder: 'sk-or-v1-...',
      keyLink: 'https://openrouter.ai/keys',
      models: [
        { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (Free)' },
        { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)' }
      ]
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      defaultModel: 'gemini-2.0-flash',
      fallbackModel: 'gemini-2.5-pro',
      keyPrefix: 'AIza',
      keyPlaceholder: 'AIzaSy...',
      keyLink: 'https://aistudio.google.com/app/apikey',
      models: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
      ]
    },
    custom: {
      id: 'custom',
      name: 'Custom / OpenAI-Compatible',
      endpoint: '',
      modelsEndpoint: '',
      defaultModel: '',
      fallbackModel: '',
      keyPrefix: '',
      keyPlaceholder: 'API Key...',
      keyLink: '',
      models: []
    }
  };

  /**
   * Migrate any retired or obsolete model ID to its modern replacement
   */
  function migrateModelId(modelId) {
    if (!modelId) return '';
    const trimmed = String(modelId).trim();
    return RETIRED_MODEL_MIGRATIONS[trimmed] || trimmed;
  }

  /**
   * Detect provider from key prefix
   */
  function detectProviderFromKey(key) {
    if (!key || typeof key !== 'string') return null;
    const k = key.trim();
    if (k.startsWith('gsk_')) {
      return { provider: 'groq', name: 'Groq', model: AI_PROVIDERS.groq.defaultModel };
    }
    if (k.startsWith('sk-or-')) {
      return { provider: 'openrouter', name: 'OpenRouter', model: AI_PROVIDERS.openrouter.defaultModel };
    }
    if (k.startsWith('AIza')) {
      return { provider: 'gemini', name: 'Google Gemini', model: AI_PROVIDERS.gemini.defaultModel };
    }
    if (k.startsWith('sk-')) {
      return { provider: 'openai', name: 'OpenAI', model: AI_PROVIDERS.openai.defaultModel };
    }
    return null;
  }

  const SETTINGS_KEY = 'mygym_ai_settings';
  const KEY_STORAGE_NAME = 'mygym_ai_key';

  /**
   * Retrieve the single consolidated AI settings store
   */
  function getAISettings() {
    const defaults = {
      provider: 'auto',
      resolvedProvider: 'groq',
      models: {
        groq: AI_PROVIDERS.groq.defaultModel,
        openai: AI_PROVIDERS.openai.defaultModel,
        openrouter: AI_PROVIDERS.openrouter.defaultModel,
        gemini: AI_PROVIDERS.gemini.defaultModel,
        custom: ''
      },
      baseUrl: '',
      rememberKey: true
    };

    let stored = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) stored = JSON.parse(raw);
      }
    } catch (_) {}

    // Migrate legacy separate localStorage keys if consolidated store not found
    if (!stored && typeof localStorage !== 'undefined') {
      const legacyProv = localStorage.getItem('mygym_ai_provider') || localStorage.getItem('ai_provider');
      const legacyModel = localStorage.getItem('mygym_ai_model') || localStorage.getItem('ai_model');
      const legacyBaseUrl = localStorage.getItem('ai_base_url');

      if (legacyProv || legacyModel || legacyBaseUrl) {
        stored = {
          provider: legacyProv || 'auto',
          models: { ...defaults.models },
          baseUrl: legacyBaseUrl || '',
          rememberKey: true
        };
        if (legacyProv && legacyProv !== 'auto' && legacyModel) {
          stored.models[legacyProv] = migrateModelId(legacyModel);
        }
      }
    }

    const result = {
      ...defaults,
      ...(stored || {}),
      models: {
        ...defaults.models,
        ...((stored && stored.models) || {})
      }
    };

    // Run model IDs through migration map
    for (const p of Object.keys(result.models)) {
      result.models[p] = migrateModelId(result.models[p]);
    }

    return result;
  }

  /**
   * Save consolidated AI settings
   */
  function saveAISettings(settings) {
    if (typeof localStorage === 'undefined') return;
    try {
      const current = getAISettings();
      const updated = {
        ...current,
        ...settings,
        models: {
          ...current.models,
          ...(settings.models || {})
        }
      };
      for (const p of Object.keys(updated.models)) {
        updated.models[p] = migrateModelId(updated.models[p]);
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));

      // Maintain legacy compatibility for external/legacy readers
      if (updated.provider) localStorage.setItem('mygym_ai_provider', updated.provider);
      const activeModel = updated.models[updated.provider] || '';
      if (activeModel) localStorage.setItem('mygym_ai_model', activeModel);
      if (updated.baseUrl) localStorage.setItem('ai_base_url', updated.baseUrl);
    } catch (_) {}
  }

  /**
   * Retrieve API key from localStorage or sessionStorage
   */
  function getAIKey() {
    try {
      if (typeof localStorage !== 'undefined') {
        const k = localStorage.getItem(KEY_STORAGE_NAME) || localStorage.getItem('ai_api_key');
        if (k) return k.trim();
      }
      if (typeof sessionStorage !== 'undefined') {
        const sk = sessionStorage.getItem(KEY_STORAGE_NAME);
        if (sk) return sk.trim();
      }
    } catch (_) {}
    return '';
  }

  /**
   * Set API key into storage
   */
  function setAIKey(key, remember = true) {
    const trimmed = (key || '').trim();
    try {
      if (remember) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(KEY_STORAGE_NAME, trimmed);
          localStorage.setItem('ai_api_key', trimmed);
        }
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(KEY_STORAGE_NAME);
        }
      } else {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(KEY_STORAGE_NAME, trimmed);
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(KEY_STORAGE_NAME);
          localStorage.removeItem('ai_api_key');
        }
      }
    } catch (_) {}
  }

  /**
   * Clear API key from both storages
   */
  function clearAIKey() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(KEY_STORAGE_NAME);
        localStorage.removeItem('ai_api_key');
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(KEY_STORAGE_NAME);
      }
    } catch (_) {}
  }

  /**
   * Cache fetched model list with 24-hour expiration
   */
  function getCachedModels(provider) {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(`mygym_models_cache_${provider}`);
      if (!raw) return null;
      const item = JSON.parse(raw);
      const now = Date.now();
      if (now - item.timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(`mygym_models_cache_${provider}`);
        return null;
      }
      return item.models;
    } catch (_) {
      return null;
    }
  }

  function setCachedModels(provider, models) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(`mygym_models_cache_${provider}`, JSON.stringify({
        timestamp: Date.now(),
        models
      }));
    } catch (_) {}
  }

  /**
   * Validate URL host against CSP connect-src allowlist
   */
  function checkCSPAllowed(urlStr) {
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();
      const isAllowed = CSP_ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith('.' + allowed));
      if (!isAllowed) {
        throw new Error(`Host "${host}" is not allowed by Content Security Policy. Allowed hosts: ${CSP_ALLOWED_HOSTS.join(', ')}`);
      }
      return true;
    } catch (err) {
      if (err.message && err.message.includes('Content Security Policy')) throw err;
      return true;
    }
  }

  /**
   * Fetch available models from provider API
   */
  async function fetchAvailableModels(provider, apiKey, baseUrl = '') {
    if (provider === 'gemini') {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models';
      checkCSPAllowed(url);
      const res = await fetch(url, {
        headers: { 'x-goog-api-key': apiKey }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const list = (data.models || [])
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => {
          const id = m.name.replace(/^models\//, '');
          return { id, name: m.displayName ? `${m.displayName} (${id})` : id };
        });
      return list;
    }

    let endpoint = '';
    if (provider === 'groq') {
      endpoint = 'https://api.groq.com/openai/v1/models';
    } else if (provider === 'openai') {
      endpoint = 'https://api.openai.com/v1/models';
    } else if (provider === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1/models';
    } else if (provider === 'custom') {
      let b = baseUrl || 'https://api.openai.com/v1';
      endpoint = b.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '') + '/models';
    }

    if (!endpoint) return [];
    checkCSPAllowed(endpoint);

    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    let list = (data.data || []).map(m => ({ id: m.id, name: m.name || m.id }));

    // Filter out non-chat models
    if (provider === 'groq') {
      list = list.filter(m => !m.id.includes('whisper') && !m.id.includes('tts'));
    } else if (provider === 'openai') {
      list = list.filter(m =>
        (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('chatgpt-')) &&
        !m.id.includes('realtime') && !m.id.includes('audio') && !m.id.includes('transcription')
      );
    }

    return list;
  }

  return {
    CSP_ALLOWED_HOSTS,
    RETIRED_MODEL_MIGRATIONS,
    AI_PROVIDERS,
    migrateModelId,
    detectProviderFromKey,
    getAISettings,
    saveAISettings,
    getAIKey,
    setAIKey,
    clearAIKey,
    getCachedModels,
    setCachedModels,
    checkCSPAllowed,
    fetchAvailableModels
  };
});

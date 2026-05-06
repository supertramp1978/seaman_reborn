import { pipeline } from '@huggingface/transformers';

let _extractor = null;
let _loadPromise = null;

export async function loadEmbedder({ onProgress } = {}) {
  if (_extractor) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    _extractor = await pipeline(
      'feature-extraction',
      'Xenova/multilingual-e5-small',
      {
        quantized: true,
        progress_callback: (d) => {
          if (d.status === 'progress' || d.status === 'download') {
            onProgress?.((d.progress ?? 0) / 100);
          }
        },
      },
    );
  })();

  return _loadPromise;
}

/**
 * テキストを 384 次元の正規化済み embedding に変換する。
 * @param {string} text
 * @param {'query'|'passage'} kind - query: で検索、passage: で保存
 * @returns {Promise<number[]>}
 */
export async function embed(text, kind = 'query') {
  if (!_extractor) throw new Error('[embedder] not loaded');
  const prefixed = `${kind}: ${text}`;
  const out = await _extractor(prefixed, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

export function getEmbedderStatus() {
  return { loaded: _extractor !== null, loading: _loadPromise !== null && _extractor === null };
}

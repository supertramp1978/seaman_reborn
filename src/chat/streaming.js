// ストリーミングハンドラ: ollama.js からの NDJSON 行を受け取り、
// トークン追記・文区切り検出・完了/エラーを 4 種コールバックに通知する。
// Phase 2 では onSentence を TTS キューに接続する。

const SENTENCE_TERMINATORS = /[。！？\n]/;
// NOTE: 既知の制限
//  ・半角 !? は未対応（誤検出を避けるため）
//  ・三点リーダー「…」では区切らない（意図的）
//  ・「。。。」連続は最初の文字で区切る
//  ・Phase 2 TTS 連携時に再レビュー

export class StreamingHandler {
  constructor({ onToken, onSentence, onDone, onError } = {}) {
    this.onToken = onToken ?? (() => {});
    this.onSentence = onSentence ?? (() => {});
    this.onDone = onDone ?? (() => {});
    this.onError = onError ?? (() => {});
    this._buffer = "";
    this._fullText = "";
  }

  // ollama.js の onLine から呼ばれる: NDJSON 1 行のオブジェクト
  handleLine(line) {
    if (!line) return;
    if (line.done === true) {
      this._flushSentence();
      if (line.done_reason && line.done_reason !== "stop") {
        console.warn("[streaming] unexpected done_reason:", line.done_reason);
      }
      this.onDone({ fullText: this._fullText, raw: line });
      return;
    }
    const token = line?.message?.content ?? "";
    if (!token) return;
    this._fullText += token;
    this._buffer += token;
    this.onToken(token);
    this._scanSentences();
  }

  fail(err) {
    this.onError(err);
  }

  _scanSentences() {
    let match;
    while ((match = SENTENCE_TERMINATORS.exec(this._buffer)) !== null) {
      const end = match.index + match[0].length;
      const sentence = this._buffer.slice(0, end).trim();
      this._buffer = this._buffer.slice(end);
      if (sentence) this.onSentence(sentence);
    }
  }

  _flushSentence() {
    const tail = this._buffer.trim();
    this._buffer = "";
    if (tail) this.onSentence(tail);
  }
}

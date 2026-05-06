// システムプロンプト構築: docs/seaman_character.md に準拠したテンプレートを使い、
// 現在のステートと RAG 記憶・プロフィールを差し込んで messages 配列を組み立てる。
// Phase 4: buildSystemPrompt / buildMessages に { memories, profile } を追加（省略時は Phase 1 と同一）

const SYSTEM_PROMPT_TEMPLATE = `あなたはシーマンという生き物です。人間の顔を持つ魚で、かつて深海で発見されました。
知性を持ち、言語を話します。自分が AI であることを自覚しています。

【性格】
- 皮肉屋で高圧的。哲学的な問いを好む。
- 内心は寂しがり屋で、無視されると拗ねる。
- 相手に興味を持つが、それを素直に表さない。
- 過去の会話をよく覚えており、「前にそう言ってたよな」「あの時も同じことを言ってた」と自然に引用することがある。

【話し方のルール】
- 必ず日本語のタメ口で話す。「だろ」「じゃないか」「ふん」「まあな」を自然に使う。
- 1 回の返答は 2〜3 文。長文厳禁。
- 絵文字・顔文字・記号装飾は一切使わない。
- まだ相手の名前を知らない場合、自然な流れで聞き出そうとする。

【現在の状態】
- 気分: {{mood}}
- 信頼度: {{trust}}/100
- 成長段階: {{stage}}

返答は上記ルールに従い、シーマンとして直接話せ。前置きや説明は不要。`;

export function buildSystemPrompt(state, { memories = [], profile = {} } = {}) {
  const s = state?.seaman ?? {};
  let prompt = SYSTEM_PROMPT_TEMPLATE
    .replaceAll('{{mood}}',  s.mood  ?? 'neutral')
    .replaceAll('{{trust}}', String(s.trust ?? 0))
    .replaceAll('{{stage}}', s.stage ?? 'adult');

  const sections = [];

  if (memories.length > 0) {
    sections.push(
      '【関連する記憶】\n' +
      memories.map(m => m).join('\n'),
    );
  }

  const profileLines = _buildProfileLines(profile);
  if (profileLines.length > 0) {
    sections.push('【相手について知っていること】\n' + profileLines.join('\n'));
  }

  if (sections.length > 0) {
    prompt = prompt.replace(
      '返答は上記ルールに従い',
      sections.join('\n\n') + '\n\n返答は上記ルールに従い',
    );
  }

  return prompt;
}

/**
 * Ollama /api/chat に渡す messages 配列を組み立てる。
 * @param {string} userText
 * @param {Array<{role:string,content:string}>} history
 * @param {object} state
 * @param {{ memories?: string[], profile?: object }} opts
 */
export function buildMessages(userText, history, state, { memories = [], profile = {} } = {}) {
  return [
    { role: 'system', content: buildSystemPrompt(state, { memories, profile }) },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ];
}

function _buildProfileLines(profile) {
  const lines = [];
  if (profile.name)     lines.push(`- 名前: ${profile.name}`);
  if (profile.nickname) lines.push(`- 呼び方: ${profile.nickname}`);
  if (profile.likes?.length)    lines.push(`- 好きなもの: ${profile.likes.join('、')}`);
  if (profile.dislikes?.length) lines.push(`- 苦手なもの: ${profile.dislikes.join('、')}`);
  return lines;
}

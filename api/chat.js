const { createClient } = require('@supabase/supabase-js');


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// プラン別モデル選択
const MODEL_MAP = {
  free:     'gemini-1.5-flash',
  standard: 'gemini-2.0-flash',
  vip:      'gemini-2.0-flash'
};

module.exports = async (req, res) => {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, characterId, userId, plan = 'free' } = req.body;

    if (!messages || !characterId) {
      return res.status(400).json({ error: 'messages and characterId are required' });
    }

    // ① Supabaseからキャラのプロンプトを取得
    const { data: charData } = await supabase
      .from('characters')
      .select('*, character_prompts(*)')
      .eq('id', characterId)
      .single();

    // ② Supabaseからユーザーの記憶を取得
    let memoryText = '';
    if (userId) {
      const { data: memories } = await supabase
        .from('memories')
        .select('content, memory_type')
        .eq('user_id', userId)
        .eq('character_id', characterId)
        .order('updated_at', { ascending: false })
        .limit(10);

      if (memories?.length) {
        const longMem = memories.filter(m => m.memory_type === 'long').map(m => m.content).join('\n');
        const shortMem = memories.filter(m => m.memory_type === 'short').map(m => m.content).join('\n');
        if (longMem) memoryText += `【このユーザーについて覚えていること】\n${longMem}\n\n`;
        if (shortMem) memoryText += `【最近の会話の要約】\n${shortMem}\n`;
      }
    }

    // ③ 時間帯判定
    const hour = new Date().getHours();
    const timePrompt = hour >= 22 || hour < 5
      ? '今は深夜。少し特別な時間帯として、よりしっとりした雰囲気で。'
      : hour >= 17
      ? '今は夜。仕事帰りのお客さんに「お疲れ様」の気持ちで。'
      : '今は昼間。明るく気軽な会話を。';

    // ④ システムプロンプト組み立て
    const basePrompt = charData?.character_prompts?.[0]?.system_prompt
      || `あなたは${charData?.name || 'ホステス'}です。`;

    const systemPrompt = [
      basePrompt,
      timePrompt,
      memoryText
    ].filter(Boolean).join('\n\n');

    // ⑤ モデル選択
    const model = MODEL_MAP[plan] || MODEL_MAP.free;

    // ⑥ Gemini API呼び出し
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.85
          }
        })
      }
    );

    const geminiData = await geminiRes.json();
    const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
      || 'ごめんなさい、少し聞こえなかったわ…もう一度話しかけてくれる？';

    // ⑦ 会話をSupabaseに保存（userId がある場合）
    if (userId) {
      await supabase.from('conversations').insert({
        user_id: userId,
        character_id: characterId,
        messages: messages,
        affinity_gained: 2
      });

      // 好感度を更新
      await supabase.rpc('increment_affinity', {
        p_user_id: userId,
        p_character_id: characterId,
        p_amount: 2
      });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('chat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
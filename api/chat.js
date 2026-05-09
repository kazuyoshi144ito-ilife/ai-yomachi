const MODEL_MAP = {
  free:     'gemini-1.5-flash',
  standard: 'gemini-2.0-flash',
  vip:      'gemini-2.0-flash'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, plan = 'free', systemPrompt } = req.body;

    if (!messages) return res.status(400).json({ error: 'messages required' });

    const model = MODEL_MAP[plan] || MODEL_MAP.free;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt || 'あなたは親切なアシスタントです。' }]
          },
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

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Gemini API error', detail: data });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
      || 'ごめんなさい、少し聞こえなかったわ…もう一度話しかけてくれる？';

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('chat error:', err);
    return res.status(500).json({ error: err.message });
  }
};
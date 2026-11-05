function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function generatedText(result) {
  if (typeof result === 'string') return result.trim();
  const direct = result?.response ?? result?.output_text ?? result?.text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const choiceText = result?.choices?.[0]?.message?.content;
  if (typeof choiceText === 'string' && choiceText.trim()) return choiceText.trim();
  if (Array.isArray(result?.output)) {
    return result.output.flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(item => item.type === 'output_text' || item.type === 'text')
      .map(item => item.text || '').join('\n').trim();
  }
  return '';
}

async function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== 'function') return json({ error: 'AI captions are not configured.' }, 503);
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'No audio was received.' }, 400);
  if (audio.byteLength > 2 * 1024 * 1024) return json({ error: 'The audio segment was too large.' }, 413);
  const type = request.headers.get('content-type') || '';
  if (!/audio\//i.test(type) && !/webm|ogg|wav|mp4/i.test(type)) return json({ error: 'Unsupported audio format.' }, 415);

  try {
    const base64 = await toBase64(audio);
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64,
      task: 'transcribe',
      vad_filter: true,
      beam_size: 3,
      condition_on_previous_text: false
    });
    const originalText = String(result?.text || '').trim();
    if (!originalText) return json({ originalText: '', translatedText: '' });
    let translatedText = originalText;
    if (new URL(request.url).searchParams.get('translate') === '1') {
      const translated = await env.AI.run('@cf/openai/gpt-oss-120b', {
        messages: [
          { role: 'system', content: 'Translate this short live meeting caption into clear, faithful English. The speech may mix Egyptian Arabic and English in the same sentence. Keep words already spoken in English unchanged. Translate only the non-English parts. Do not summarize, add meaning, or guess unclear words. Return only the caption in English.' },
          { role: 'user', content: originalText }
        ],
        temperature: 0.1,
        max_tokens: 300
      });
      translatedText = generatedText(translated) || originalText;
    }
    return json({ originalText, translatedText });
  } catch (error) {
    return json({ error: 'Caption AI error: ' + (error?.message || 'unknown error') }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return json({ error: 'Transcription is not configured yet. Add a Workers AI binding named AI to the zoom-clone Pages project and redeploy.' }, 503);
  }

  const url = new URL(request.url);
  const language = url.searchParams.get('language') || 'ar';
  const allowed = new Set(['ar', 'en', 'zh', 'ja']);
  if (!allowed.has(language)) return json({ error: 'Unsupported transcript language.' }, 400);

  const contentType = request.headers.get('content-type') || 'audio/webm';
  if (!/^audio\//i.test(contentType) && !/webm|mp4|mpeg|wav|ogg/i.test(contentType)) {
    return json({ error: 'The uploaded recording audio format is not supported.' }, 415);
  }

  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'The recording did not contain audio.' }, 400);
  if (audio.byteLength > 24 * 1024 * 1024) {
    return json({ error: 'This recording audio is too large for one free transcription request. Try a shorter meeting.' }, 413);
  }

  try {
    const bytes = new Uint8Array(audio);
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    const base64 = btoa(binary);
    const prompt = language === 'ar'
      ? 'The speakers primarily use Egyptian Arabic (Masri), colloquial Egyptian expressions, and may switch between Arabic and English. Understand Egyptian colloquial speech and translate the meaning faithfully into natural English. Preserve names and technical terms.'
      : 'Translate the spoken content faithfully into natural English. Preserve names and technical terms.';
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64,
      task: 'translate',
      language,
      initial_prompt: prompt,
      vad_filter: true
    });
    const text = String(result?.text || '').trim();
    if (!text) return json({ error: 'No clear speech was detected.' }, 422);
    return json({ text });
  } catch (error) {
    return json({ error: 'Transcription service error: ' + (error?.message || 'unknown error') }, 502);
  }
}

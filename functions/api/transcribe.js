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
    return result.output
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(item => item.type === 'output_text' || item.type === 'text')
      .map(item => item.text || '')
      .join('\n')
      .trim();
  }
  return '';
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

    const originalResult = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64,
      task: 'transcribe',
      language,
      vad_filter: true,
      beam_size: 5,
      condition_on_previous_text: false
    });
    const originalText = String(originalResult?.text || '').trim();
    if (!originalText) return json({ error: 'No clear speech was detected.' }, 422);

    let translatedText = originalText;
    if (language !== 'en') {
      const languageNames = { ar: 'Egyptian Arabic (colloquial Arabic)', zh: 'Chinese', ja: 'Japanese' };
      const translationResult = await env.AI.run('@cf/openai/gpt-oss-120b', {
        messages: [
          {
            role: 'system',
            content: [
              'You are an expert human translator.',
              'Translate the supplied transcript into clear, natural English.',
              'The source may be colloquial Egyptian Arabic, not Modern Standard Arabic.',
              'Understand idioms, everyday expressions, implied meaning, and context before translating.',
              'Translate meaning faithfully rather than word-for-word.',
              'Do not summarize, explain, add details, censor, or invent anything.',
              'Keep names, numbers, dates, and technical terms accurate.',
              'Preserve the speaker order and paragraph breaks where practical.',
              'If a phrase is genuinely unclear, translate only what is clear and preserve the uncertainty; do not guess.',
              'Return only the English translation. No introduction, notes, labels, or quotation marks.'
            ].join(' ')
          },
          {
            role: 'user',
            content: 'Translate this ' + (languageNames[language] || 'non-English') + ' meeting transcript into English:\n\n' + originalText
          }
        ],
        temperature: 0.1,
        max_tokens: 12000
      });
      translatedText = generatedText(translationResult);
      if (!translatedText) {
        return json({ error: 'The original transcript was created, but the English translation model returned no text. Please try again.' }, 502);
      }
      if (/[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF]/.test(translatedText)) {
        return json({ error: 'The translation model did not return English text. Please try again.' }, 502);
      }
    }

    return json({ originalText, translatedText });
  } catch (error) {
    return json({ error: 'Transcription or translation service error: ' + (error?.message || 'unknown error') }, 502);
  }
}

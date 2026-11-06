export async function onRequestPost() {
  return new Response(JSON.stringify({
    error: 'AI transcription and translation are disabled in Convo.'
  }), {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

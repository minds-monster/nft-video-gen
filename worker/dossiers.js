const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * Handle listing existing dossiers from the KV store.
 */
export async function handleDossiersList(request, env) {
  if (!env.DOSSIERS) {
    return json({ error: 'DOSSIERS KV not configured' }, 500);
  }

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get('cursor') || undefined;
  const limit = Math.min(Number(searchParams.get('limit')) || 24, 100);

  try {
    const options = { prefix: 'dossier:', limit };
    if (cursor) options.cursor = cursor;
    const listResult = await env.DOSSIERS.list(options);

    // Fetch all values concurrently
    const dossiers = await Promise.all(
      listResult.keys.map(async (keyObj) => {
        const record = await env.DOSSIERS.get(keyObj.name, 'json');
        return record;
      })
    );

    return json({
      dossiers: dossiers.filter(Boolean),
      cursor: listResult.cursor,
      listComplete: listResult.list_complete,
    });
  } catch (error) {
    console.error('Error fetching dossiers:', error);
    return json({ error: 'Failed to fetch dossiers' }, 500);
  }
}

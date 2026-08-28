// Publish the site: trigger one Netlify build carrying every change saved
// since the last publish. Ordinary git pushes don't build (see the ignore
// rule in netlify.toml) — this function's build hook is what builds.
//
// Environment variables (Netlify dashboard → Site settings → Environment):
//   BUILD_HOOK_URL     — required. A build hook for the master branch
//                        (Site configuration → Build & deploy → Build hooks).
//   NETLIFY_AUTH_TOKEN — optional. Lets GET report the last published
//                        commit, so the admin can count waiting changes.
//
// Only signed-in Netlify Identity users (the admin) can call this.

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  }

  // GET — status: when was the site last published, and from which commit
  if (event.httpMethod === 'GET') {
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (!token) return { statusCode: 200, body: JSON.stringify({}) };
    try {
      const res = await fetch(`https://api.netlify.com/api/v1/sites/${process.env.SITE_ID}/deploys?per_page=8`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`deploys ${res.status}`);
      const deploys = await res.json();
      const ready = deploys.find(d => d.state === 'ready' && d.context === 'production');
      const building = deploys.some(d => ['building', 'enqueued', 'processing', 'new'].includes(d.state));
      return {
        statusCode: 200,
        body: JSON.stringify(ready ? {
          commit_ref: ready.commit_ref || null,
          published_at: ready.published_at || ready.created_at,
          building,
        } : { building }),
      };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({}) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const hook = process.env.BUILD_HOOK_URL;
  if (!hook) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Publishing is not configured yet — create a build hook in the Netlify dashboard (Build & deploy → Build hooks) and set BUILD_HOOK_URL in the environment variables.' }),
    };
  }

  try {
    const res = await fetch(hook, { method: 'POST' });
    if (!res.ok) throw new Error(`Build hook answered ${res.status}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};

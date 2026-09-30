/**
 * NearBuyGoods Project Tracker — REST API.
 *
 * Returns route descriptors in exactly the shape server.js's router expects,
 * so the tracker rides on the same HTTP server / Vercel function as the rest
 * of the app (one deploy, one origin, no CORS games).
 *
 * Auth: tracker accounts carry their own HMAC-signed bearer token
 * (`Authorization: Bearer <token>`), independent of the shopper JWT.
 */

const json = (ctx, code, obj) => ctx.send(code, obj);

export function trackerRoutes(tracker) {
  const routes = [];

  const T = (method, pattern, handler, opts = {}) => {
    routes.push({
      method,
      pattern,
      // Only rate-limiting is delegated to the shared router: the tracker
      // authenticates with its own token inside the wrapper, so the app's
      // JWT gate must stay off (`auth: true` here would demand a shopper login).
      opts: { limit: opts.limit },
      handler: async (ctx) => {
        ctx.skipSave = true; // tracker writes go to its own store, not the app database
        try {
          if (opts.account !== false) {
            ctx.account = await tracker.auth.accountFromRequest(ctx.req);
            if (opts.auth && !ctx.account) return json(ctx, 401, { error: 'sign in to use the tracker' });
          }
          const project = (ctx.query.project || ctx.body?.project || ctx.body?.project_id) || null;
          if (opts.project) {
            ctx.project = await tracker.projects.require(
              ctx.account,
              project || (await tracker.projects.list(ctx.account))[0]?.id,
            );
          }
          // Mutations are batched: a bulk drop or a 100-row patch hits the
          // backing store once (matters for the KV/JSON drivers, no-op on SQL).
          if (ctx.req.method === 'GET' || !tracker.store.batch) await handler(ctx);
          else await tracker.store.batch(() => handler(ctx));
        } catch (e) {
          const status = e.status || 500;
          if (status >= 500) console.error('[tracker]', ctx.req.method, ctx.req.url, e);
          if (!ctx.res.headersSent) json(ctx, status, { error: e.message || 'tracker error', ...(e.extra || {}) });
        }
      },
    });
  };

  /* ------------------------------------------------------------- meta ---- */

  T('GET', '/api/tracker/health', async (ctx) => {
    const [features, projects, workspaces] = await Promise.all([
      tracker.store.count('features'), tracker.store.count('projects'), tracker.store.count('workspaces'),
    ]);
    const health = await tracker.store.health().catch((e) => ({ ok: false, detail: e.message }));
    json(ctx, 200, {
      ok: true, version: tracker.version, database: { mode: tracker.store.mode, label: tracker.store.label, ...health },
      counts: { projects, workspaces, features },
    });
  }, { account: false });

  T('GET', '/api/tracker/meta', async (ctx) => {
    json(ctx, 200, {
      statuses: tracker.constants.FEATURE_STATUSES,
      priorities: tracker.constants.PRIORITIES,
      efforts: ['xs', 's', 'm', 'l', 'xl'],
      stages: tracker.constants.DEFAULT_STAGES,
      database: { mode: tracker.store.mode, label: tracker.store.label },
      guest_enabled: tracker.demoMode,
    });
  }, { account: false });

  T('POST', '/api/tracker/seed', async (ctx) => json(ctx, 200, await tracker.seed()), { account: false, limit: 30 });  // already inside the batched wrapper

  /* ------------------------------------------------------------- auth ---- */

  T('POST', '/api/tracker/auth/register', async (ctx) => json(ctx, 201, await tracker.auth.register(ctx.body)), { account: false, limit: 20 });
  T('POST', '/api/tracker/auth/login', async (ctx) => json(ctx, 200, await tracker.auth.login(ctx.body)), { account: false, limit: 30 });
  T('POST', '/api/tracker/auth/guest', async (ctx) => json(ctx, 200, await tracker.auth.guest(ctx.body)), { account: false, limit: 40 });
  T('GET', '/api/tracker/auth/me', async (ctx) => {
    if (!ctx.account) return json(ctx, 200, { account: null });
    const projects = await tracker.projects.list(ctx.account);
    json(ctx, 200, { account: tracker.auth.publicAccount(ctx.account), projects: projects.map((p) => ({ id: p.id, name: p.name, key: p.key })) });
  });

  /* -------------------------------------------------------- bootstrap ---- */

  T('GET', '/api/tracker/bootstrap', async (ctx) => {
    if (!ctx.account) return json(ctx, 200, { me: null, projects: [], project: null, database: { mode: tracker.store.mode, label: tracker.store.label } });
    const data = await tracker.bootstrap(ctx.account, ctx.query.project || null);
    json(ctx, 200, {
      ...data,
      database: { mode: tracker.store.mode, label: tracker.store.label },
      // Serverless functions can't hold an SSE stream open → the client polls.
      capabilities: { ...(data.capabilities || {}), on_vercel: !!process.env.VERCEL, live: !process.env.VERCEL },
    });
  });

  /* --------------------------------------------------------- projects ---- */

  T('GET', '/api/tracker/projects', async (ctx) => json(ctx, 200, { projects: await tracker.projects.list(ctx.account) }), { auth: true });
  T('POST', '/api/tracker/projects', async (ctx) => {
    const { name, key, description, accent, seed = 'blank' } = ctx.body || {};
    const project = await tracker.projects.create(ctx.account, { name, key, description, accent, seed });
    await tracker.log(project.id, ctx.account, 'project.created', 'project', project.id, project.name, { seed });
    json(ctx, 201, { project });
  }, { auth: true });
  T('PATCH', '/api/tracker/projects/:id', async (ctx) => {
    const project = await tracker.projects.update(ctx.account, ctx.params.id, ctx.body || {});
    json(ctx, 200, { project });
  }, { auth: true });

  /* --------------------------------------------------------- features ---- */

  T('GET', '/api/tracker/features', async (ctx) => {
    const { project, ...filters } = ctx.query;
    const features = await tracker.features.list(ctx.project.id, filters);
    json(ctx, 200, { features, total: features.length });
  }, { auth: true, project: true });

  T('POST', '/api/tracker/features', async (ctx) => {
    const feature = await tracker.features.create(ctx.account, ctx.project.id, ctx.body || {});
    await tracker.log(ctx.project.id, ctx.account, 'feature.created', 'feature', feature.id, feature.title, {});
    json(ctx, 201, { feature });
  }, { auth: true, project: true });

  T('PATCH', '/api/tracker/features/:id', async (ctx) => {
    const feature = await tracker.features.update(ctx.account, ctx.project.id, ctx.params.id, ctx.body || {});
    json(ctx, 200, { feature });
  }, { auth: true, project: true });

  T('DELETE', '/api/tracker/features/:id', async (ctx) => json(ctx, 200, await tracker.features.remove(ctx.account, ctx.project.id, ctx.params.id)), { auth: true, project: true });

  /** Bulk edit / bulk move / bulk delete — what multi-select drags use. */
  T('POST', '/api/tracker/features/bulk', async (ctx) => {
    const { ids = [], patch = {}, action, workspace_id, stage } = ctx.body || {};
    if (!ids.length) throw Object.assign(new Error('no features selected'), { status: 400 });
    const updated = [];
    if (action === 'delete') {
      for (const id of ids) await tracker.features.remove(ctx.account, ctx.project.id, id);
      return json(ctx, 200, { deleted: ids.length });
    }
    if (action === 'place') {
      const placed = await tracker.placements.placeMany(ctx.account, ctx.project.id, { workspace_id, feature_ids: ids, stage });
      return json(ctx, 200, { placements: placed });
    }
    for (const id of ids) updated.push(await tracker.features.update(ctx.account, ctx.project.id, id, patch, { silent: true }));
    await tracker.log(ctx.project.id, ctx.account, 'features.bulk_updated', 'project', ctx.project.id, `${ids.length} features`, { patch: Object.keys(patch) });
    tracker.emit(ctx.project.id, { type: 'features', action: 'bulk', features: updated });
    json(ctx, 200, { features: updated });
  }, { auth: true, project: true });

  /* ------------------------------------------------------- workspaces ---- */

  T('GET', '/api/tracker/workspaces', async (ctx) => {
    const workspaces = await tracker.workspaces.list(ctx.project.id);
    json(ctx, 200, { workspaces: workspaces.sort((a, b) => a.position - b.position) });
  }, { auth: true, project: true });

  T('POST', '/api/tracker/workspaces', async (ctx) => {
    const ws = await tracker.workspaces.create(ctx.account, ctx.project.id, ctx.body || {});
    await tracker.log(ctx.project.id, ctx.account, 'workspace.created', 'workspace', ws.id, ws.name, {});
    json(ctx, 201, { workspace: ws });
  }, { auth: true, project: true });

  T('PATCH', '/api/tracker/workspaces/:id', async (ctx) => json(ctx, 200, { workspace: await tracker.workspaces.update(ctx.account, ctx.project.id, ctx.params.id, ctx.body || {}) }), { auth: true, project: true });
  T('DELETE', '/api/tracker/workspaces/:id', async (ctx) => json(ctx, 200, await tracker.workspaces.remove(ctx.account, ctx.project.id, ctx.params.id)), { auth: true, project: true });
  T('GET', '/api/tracker/workspaces/:id/cards', async (ctx) => json(ctx, 200, await tracker.workspaces.board(ctx.project.id, ctx.params.id)), { auth: true, project: true });

  /* ---------------------------- placements: the drag & drop persistence ---- */

  T('POST', '/api/tracker/placements', async (ctx) => {
    const { workspace_id, feature_ids = [], stage, index = null, exclusive = true } = ctx.body || {};
    const placements = await tracker.placements.placeMany(ctx.account, ctx.project.id, { workspace_id, feature_ids, stage, index, exclusive });
    json(ctx, 201, { placements });
  }, { auth: true, project: true });

  T('POST', '/api/tracker/placements/move', async (ctx) => {
    const { moves = [] } = ctx.body || {};
    const placements = await tracker.placements.moveMany(ctx.account, ctx.project.id, moves);
    json(ctx, 200, { placements });
  }, { auth: true, project: true });

  T('POST', '/api/tracker/placements/remove', async (ctx) => json(ctx, 200, await tracker.placements.unplace(ctx.account, ctx.project.id, ctx.body || {})), { auth: true, project: true });

  /* ------------------------------------------------- activity & chatter ---- */

  T('GET', '/api/tracker/activity', async (ctx) => {
    const limit = Math.min(Number(ctx.query.limit) || 60, 300);
    const rows = await tracker.store.find('activity', { project_id: ctx.project.id });
    json(ctx, 200, { activity: rows.slice(-limit).reverse(), viewers: tracker.viewerCount(ctx.project.id) });
  }, { auth: true, project: true });

  T('GET', '/api/tracker/comments', async (ctx) => json(ctx, 200, { comments: await tracker.comments.list(ctx.project.id, ctx.query.subject_id || null) }), { auth: true, project: true });
  T('POST', '/api/tracker/comments', async (ctx) => json(ctx, 201, { comment: await tracker.comments.add(ctx.account, ctx.project.id, ctx.body || {}) }), { auth: true, project: true });

  /* ------------------------------------------------------------ tools ---- */

  T('GET', '/api/tracker/stats', async (ctx) => json(ctx, 200, await tracker.stats(ctx.project.id)), { auth: true, project: true });
  T('GET', '/api/tracker/search', async (ctx) => json(ctx, 200, await tracker.search(ctx.project.id, ctx.query.q, Math.min(Number(ctx.query.limit) || 12, 40))), { auth: true, project: true });

  T('POST', '/api/tracker/import', async (ctx) => {
    const { source = 'text', text = '', mode = 'merge', project } = ctx.body || {};
    const projectId = ctx.project ? ctx.project.id : (project || (await tracker.projects.list(ctx.account))[0]?.id);
    if (!projectId) throw Object.assign(new Error('create a project first'), { status: 400 });
    const result = await tracker.importDoc(ctx.account, projectId, { source, text, mode });
    json(ctx, 200, result);
  }, { auth: true, project: true });

  T('POST', '/api/tracker/plan', async (ctx) => {
    const { workspace_id, rules = {}, stage, mode = 'add' } = ctx.body || {};
    json(ctx, 200, await tracker.plan(ctx.account, ctx.project.id, { workspace_id, rules, stage, mode }));
  }, { auth: true, project: true });

  T('GET', '/api/tracker/export', async (ctx) => {
    const format = ctx.query.format === 'csv' ? 'csv' : 'json';
    const data = await tracker.exportProject(ctx.project.id, format);
    if (format === 'csv') {
      ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nearbuygoods-features.csv"' });
      return ctx.res.end(data);
    }
    json(ctx, 200, data);
  }, { auth: true, project: true });

  T('POST', '/api/tracker/invites', async (ctx) => json(ctx, 201, { invite: await tracker.invite(ctx.account, ctx.project.id, ctx.body || {}) }), { auth: true, project: true });
  T('POST', '/api/tracker/invites/:token/accept', async (ctx) => json(ctx, 200, await tracker.acceptInvite(ctx.account, ctx.params.token)), { auth: true });

  /* ------------------------------------------------------------- live ---- */

  /**
   * Server-Sent Events: board changes from every other viewer land here.
   * Serverless functions are too short-lived to hold a stream open, so on
   * Vercel we answer 204 and the client polls instead (it reads the
   * `x-tracker-live: off` header to know).
   */
  T('GET', '/api/tracker/events', async (ctx) => {
    if (!ctx.account) return json(ctx, 401, { error: 'sign in to use the tracker' });
    const projectId = ctx.project.id;
    if (ctx.query.probe === '1') {
      return json(ctx, 200, { live: true, viewers: tracker.viewerCount(projectId) });
    }
    const res = ctx.res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'x-tracker-live': 'on',
    });
    res.write(`retry: 4000\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'hello', project_id: projectId, at: new Date().toISOString() })}\n\n`);
    const unsubscribe = tracker.subscribe(projectId, res, { name: ctx.account.name, id: ctx.account.id, at: new Date().toISOString() });
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    const end = () => { clearInterval(beat); unsubscribe(); try { res.end(); } catch { /* noop */ } };
    ctx.req.on('close', end);
    ctx.req.on('error', end);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
  }, { auth: true, project: true });

  return routes;
}

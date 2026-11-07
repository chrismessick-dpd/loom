/* In-memory fake of the GitHub API the Signoff engine uses: several repos, collaborators,
   /user/repos listing. Copied from signoff_pl/tests/fake-hub.js (itself from Signoff EE's tests).
   new FakeHub(); hub.makeRepo('owner/name', { path: text }, [logins]); hub.fetchFor('tok-<login>');
   hub.files(full); hub.push(full, files); hub.calls lists every request. */
(function () {
'use strict';
function FakeHub() {
  var hub = this;
  hub.repos = {}; hub.n = 0; hub.calls = []; hub.inviteSeq = 1; hub.raceOnce = null;
  function id() { return (++hub.n).toString(16).padStart(40, '0'); }
  function commitFiles(repo, files) {
    var t = id(); repo.trees[t] = files; var c = id(); repo.commits[c] = { tree: t, parent: repo.head }; repo.head = c; return c;
  }
  hub.makeRepo = function (full, files, members) {
    hub.repos[full] = { trees: {}, commits: {}, head: null, blobs: {}, collaborators: (members || []).slice(), invitations: [] };
    commitFiles(hub.repos[full], files);
  };
  hub.files = function (full) { var r = hub.repos[full]; return Object.assign({}, r.trees[r.commits[r.head].tree]); };
  hub.push = function (full, files) { commitFiles(hub.repos[full], files); };
  hub.fetchFor = function (token) {
    var login = token.replace(/^tok-/, '');
    return async function (url, opts) {
      var u = url.replace('https://api.github.com', ''), method = opts.method || 'GET';
      var body = opts.body ? JSON.parse(opts.body) : null;
      hub.calls.push(login + ' ' + method + ' ' + u);
      function res(status, data) { return { ok: status < 300, status: status, text: async function () { return data === undefined ? '' : JSON.stringify(data); } }; }
      if (u === '/user') return res(200, { login: login, name: login.toUpperCase() });
      if (/^\/users\//.test(u)) return res(200, { login: u.split('/')[2], type: 'User' });
      if (/^\/user\/repos\?/.test(u) && method === 'GET') {
        return res(200, Object.keys(hub.repos).filter(function (f) { return hub.repos[f].collaborators.indexOf(login) >= 0; })
          .map(function (f) { return { name: f.split('/')[1], owner: { login: f.split('/')[0] } }; }));
      }
      if (u === '/user/repos' && method === 'POST') {
        var full = login + '/' + body.name;
        if (hub.repos[full]) return res(422, { message: 'name already exists on this account' });
        hub.makeRepo(full, { 'README.md': '# ' + body.name }, [login]);
        return res(201, { full_name: full });
      }
      if (/^\/user\/repository_invitations\?/.test(u)) {
        var mine = [];
        Object.keys(hub.repos).forEach(function (f) {
          hub.repos[f].invitations.forEach(function (i) { if (i.login === login) mine.push({ id: i.id, repository: { full_name: f, owner: { login: f.split('/')[0] } } }); });
        });
        return res(200, mine);
      }
      var acc = /^\/user\/repository_invitations\/(\d+)$/.exec(u);
      if (acc && method === 'PATCH') {
        Object.keys(hub.repos).forEach(function (f) {
          var r = hub.repos[f];
          r.invitations.filter(function (i) { return String(i.id) === acc[1] && i.login === login; }).forEach(function () { r.collaborators.push(login); });
          r.invitations = r.invitations.filter(function (i) { return String(i.id) !== acc[1]; });
        });
        return res(204);
      }
      var m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)$/.exec(u.split('?')[0]);
      if (!m) return res(404, { message: 'Not Found: ' + u });
      var full2 = m[1] + '/' + m[2], repo = hub.repos[full2], path = m[3];
      if (!repo || repo.collaborators.indexOf(login) < 0) return res(404, { message: 'Not Found' });
      var admin = full2.split('/')[0] === login;
      if (method === 'GET' && /^\/git\/ref\/heads\//.test(path)) return res(200, { object: { sha: repo.head } });
      if (method === 'GET' && /^\/git\/commits\//.test(path)) return res(200, { tree: { sha: repo.commits[path.split('/').pop()].tree } });
      if (method === 'GET' && /^\/git\/trees\//.test(path)) {
        var files = repo.trees[path.split('/').pop()];
        var entries = await Promise.all(Object.keys(files).map(async function (p) {
          var v = files[p], s = typeof v === 'string' ? await Signoff.github.gitBlobSha(v) : await Signoff.github.gitBlobShaBytes(v);
          repo.blobs[s] = v; return { path: p, type: 'blob', sha: s, size: typeof v === 'string' ? v.length : v.length };
        }));
        return res(200, { tree: entries });
      }
      if (method === 'GET' && /^\/git\/blobs\//.test(path)) {
        var bv = repo.blobs[path.split('/').pop()];
        return res(200, { content: typeof bv === 'string' ? Signoff.github.b64Encode(bv) : Signoff.github.bytesToB64(bv) });
      }
      if (method === 'POST' && path === '/git/blobs') {
        var raw = Signoff.github.b64ToBytes(body.content), bs = await Signoff.github.gitBlobShaBytes(raw);
        repo.blobs[bs] = raw; hub.blobPosts = (hub.blobPosts || 0) + 1; return res(201, { sha: bs });
      }
      if (method === 'POST' && path === '/git/trees') {
        var f = Object.assign({}, repo.trees[body.base_tree]);
        body.tree.forEach(function (e) { if (e.sha === null) delete f[e.path]; else if (e.sha) f[e.path] = repo.blobs[e.sha]; else f[e.path] = e.content; });
        var t = id(); repo.trees[t] = f; return res(201, { sha: t });
      }
      if (method === 'POST' && path === '/git/commits') { var cs = id(); repo.commits[cs] = { tree: body.tree, parent: body.parents[0] }; return res(201, { sha: cs, html_url: 'https://github.com/' + full2 + '/commit/' + cs }); }
      if (method === 'PATCH' && /^\/git\/refs\/heads\//.test(path)) {
        if (hub.raceOnce) { var race = hub.raceOnce; hub.raceOnce = null; race(); }
        if (repo.commits[body.sha].parent !== repo.head) return res(422, { message: 'Update is not a fast forward' });
        repo.head = body.sha; return res(200, {});
      }
      if (!admin && /^\/(collaborators|invitations)/.test(path)) return res(403, { message: 'Must have admin rights' });
      if (method === 'GET' && path === '/collaborators') return res(200, repo.collaborators.map(function (l) { return { login: l }; }));
      if (method === 'GET' && path === '/invitations') return res(200, repo.invitations.map(function (i) { return { id: i.id, invitee: { login: i.login } }; }));
      var col = /^\/collaborators\/(.+)$/.exec(path);
      if (col && method === 'PUT') {
        if (repo.collaborators.indexOf(col[1]) < 0 && !repo.invitations.some(function (i) { return i.login === col[1]; })) repo.invitations.push({ id: hub.inviteSeq++, login: col[1] });
        return res(201, {});
      }
      if (col && method === 'DELETE') { repo.collaborators = repo.collaborators.filter(function (l) { return l !== col[1]; }); return res(204); }
      var inv = /^\/invitations\/(\d+)$/.exec(path);
      if (inv && method === 'DELETE') { repo.invitations = repo.invitations.filter(function (i) { return String(i.id) !== inv[1]; }); return res(204); }
      return res(404, { message: 'Not Found: ' + method + ' ' + path });
    };
  };
}
window.FakeHub = FakeHub;
})();

/**
 * The founders' reply desk (Section 3b P2b) — the page at /n/<slug>/.
 *
 * Sign in with a Supabase email magic link (anon key only; the founders have
 * no password), then read every note people sent from the app, open one,
 * reply (signed with the founder's display name) and set its status.
 *
 * SECURITY LIVES IN THE DATABASE, NOT HERE. This repo is public, so this file
 * is too. Every read and write goes through founder_list_feedback /
 * founder_get_feedback / founder_reply / founder_set_status, which refuse
 * anyone not in public.feedback_admins; the screenshot bucket's policy does
 * the same for signed URLs. A signed-in non-admin gets "Not available." and
 * nothing else. Never put the service-role key anywhere near this file.
 *
 * EVERY WORD A PERSON TYPED IS TEXT. Nodes are built with createElement and
 * filled with textContent only; nothing here parses markup
 * (tests/feedback-desk.test.js fails on the API names).
 *
 * No dependencies, no framework, no globals: the page passes in document,
 * fetch, storage and the clock. Pinned by tests/feedback-desk.test.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SakinaFeedbackDesk = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SESSION_KEY = 'sakina_desk_session';
  var OPEN_NOTE_KEY = 'sakina_desk_open_note';
  var BUCKET = 'feedback-screenshots';
  /** Seconds a signed screenshot URL lives. */
  var SIGNED_URL_SECONDS = 120;

  var KIND_LABELS = {
    wrong: 'Something looks wrong',
    broken: 'Something isn’t working',
    idea: 'An idea',
    else: 'Something else'
  };
  var STATUS_LABELS = { sent: 'Sent', looking: 'Looking', wrote_back: 'Wrote back', fixed: 'Fixed' };

  function kindLabel(kind) {
    return KIND_LABELS[kind] || 'Something else';
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || String(status || '');
  }

  function when(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  // ── the API ───────────────────────────────────────────────────────────

  function failure(code, status) {
    var e = new Error(code);
    e.code = code;
    e.status = status;
    return e;
  }

  /**
   * cfg: { url, key, fetch, token: () => access token | null }.
   * Rejections carry `code`: 'not_available' (not a founder), 'signed_out'
   * (the token was refused), 'http_<n>', or 'network'.
   */
  function createApi(cfg) {
    var base = String(cfg.url || '').replace(/\/+$/, '');

    function headers(useToken) {
      var token = useToken && cfg.token ? cfg.token() : null;
      return {
        apikey: cfg.key,
        Authorization: 'Bearer ' + (token || cfg.key),
        'Content-Type': 'application/json'
      };
    }

    function call(url, body, useToken) {
      var p;
      try {
        p = Promise.resolve(cfg.fetch(url, { method: 'POST', headers: headers(useToken), body: JSON.stringify(body || {}) }));
      } catch (_) {
        return Promise.reject(failure('network'));
      }
      return p.then(
        function (res) {
          if (res.ok) {
            if (res.status === 204) return null;
            return res.json().catch(function () {
              return null;
            });
          }
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (b) {
              if (res.status === 403 || (b && b.code === '42501')) throw failure('not_available', res.status);
              if (res.status === 401) throw failure('signed_out', res.status);
              throw failure('http_' + res.status, res.status);
            });
        },
        function () {
          throw failure('network');
        }
      );
    }

    function rpc(name, args) {
      return call(base + '/rest/v1/rpc/' + name, args, true);
    }

    return {
      listFeedback: function (limit, before) {
        var args = { p_limit: limit || 100 };
        if (before) args.p_before = before;
        return rpc('founder_list_feedback', args);
      },
      getFeedback: function (noteId) {
        return rpc('founder_get_feedback', { p_note_id: noteId });
      },
      reply: function (noteId, body) {
        return rpc('founder_reply', { p_note_id: noteId, p_body: body });
      },
      setStatus: function (noteId, status) {
        if (status !== 'looking' && status !== 'fixed') return Promise.reject(failure('bad_status'));
        return rpc('founder_set_status', { p_note_id: noteId, p_status: status });
      },
      signScreenshot: function (objectPath) {
        var encoded = String(objectPath).split('/').map(encodeURIComponent).join('/');
        return call(base + '/storage/v1/object/sign/' + BUCKET + '/' + encoded, { expiresIn: SIGNED_URL_SECONDS }, true).then(
          function (b) {
            if (!b || !b.signedURL) throw failure('no_signed_url');
            return base + '/storage/v1' + b.signedURL;
          }
        );
      },
      sendMagicLink: function (email, redirectTo) {
        // create_user:false — this page can never make an account.
        return call(
          base + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectTo),
          { email: email, create_user: false },
          false
        );
      },
      refresh: function (refreshToken) {
        return call(base + '/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken }, false);
      }
    };
  }

  // ── the address bar ───────────────────────────────────────────────────

  /** '#access_token=…&refresh_token=…' or '#note=<id>' → an object. */
  function parseHash(hash) {
    var out = {};
    String(hash || '')
      .replace(/^#/, '')
      .split('&')
      .forEach(function (pair) {
        if (!pair) return;
        var i = pair.indexOf('=');
        var k = i < 0 ? pair : pair.slice(0, i);
        var v = i < 0 ? '' : pair.slice(i + 1);
        try {
          out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
        } catch (_) {
          // A malformed pair is ignored.
        }
      });
    return out;
  }

  // ── the list order ────────────────────────────────────────────────────

  /** Pinned (flagged) first, then the rest newest first, each note once. */
  function orderNotes(result) {
    var pinned = (result && result.pinned) || [];
    var notes = (result && result.notes) || [];
    var seen = {};
    var out = [];
    pinned.forEach(function (n) {
      seen[n.id] = true;
      out.push(Object.assign({}, n, { pinned: true }));
    });
    notes
      .slice()
      .sort(function (a, b) {
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      })
      .forEach(function (n) {
        if (seen[n.id]) return;
        seen[n.id] = true;
        out.push(Object.assign({}, n, { pinned: false }));
      });
    return out;
  }

  // ── drawing (textContent only) ────────────────────────────────────────

  function el(doc, tag, className, text) {
    var e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderNotAvailable(doc, root) {
    clear(root);
    root.appendChild(el(doc, 'p', 'desk-closed', 'Not available.'));
  }

  function renderSignIn(doc, root, onSubmit) {
    clear(root);
    var form = el(doc, 'form', 'desk-signin');
    form.appendChild(el(doc, 'h1', null, 'Sign in'));
    form.appendChild(el(doc, 'p', 'desk-muted', 'We’ll email you a sign-in link.'));
    var input = el(doc, 'input', 'desk-input');
    input.setAttribute('type', 'email');
    input.setAttribute('autocomplete', 'email');
    input.setAttribute('placeholder', 'you@example.com');
    input.setAttribute('aria-label', 'Email');
    form.appendChild(input);
    var button = el(doc, 'button', 'desk-button', 'Email me a link');
    button.setAttribute('type', 'submit');
    form.appendChild(button);
    var line = el(doc, 'p', 'desk-status');
    form.appendChild(line);
    form.addEventListener('submit', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var email = String(input.value || '').trim().toLowerCase();
      if (!email) return;
      button.disabled = true;
      onSubmit(email).then(function () {
        button.disabled = false;
        line.textContent = 'If that address can sign in here, a link is on its way.';
      });
    });
    root.appendChild(form);
  }

  function renderList(doc, root, items, handlers) {
    clear(root);
    var head = el(doc, 'header', 'desk-head');
    head.appendChild(el(doc, 'h1', null, 'Notes'));
    var out = el(doc, 'button', 'desk-link', 'Sign out');
    out.setAttribute('type', 'button');
    out.addEventListener('click', handlers.onSignOut);
    head.appendChild(out);
    root.appendChild(head);
    if (!items.length) {
      root.appendChild(el(doc, 'p', 'desk-muted', 'No notes yet.'));
      return;
    }
    var list = el(doc, 'ul', 'desk-list');
    items.forEach(function (n) {
      var row = el(doc, 'li', 'desk-row' + (n.pinned ? ' desk-pinned' : ''));
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      if (n.pinned) row.appendChild(el(doc, 'span', 'desk-flag', 'Waiting over 48 h'));
      row.appendChild(el(doc, 'span', 'desk-kind', kindLabel(n.kind)));
      row.appendChild(el(doc, 'span', 'desk-meta', statusLabel(n.status) + ' · ' + when(n.created_at)));
      var title = n.words || (n.chips && n.chips.length ? n.chips.join(', ') : '');
      row.appendChild(el(doc, 'span', 'desk-title', title));
      if (n.has_screenshot) row.appendChild(el(doc, 'span', 'desk-meta', 'Screenshot'));
      if (n.message_count) {
        row.appendChild(
          el(doc, 'span', 'desk-meta', n.message_count + (n.message_count === 1 ? ' message' : ' messages') +
            (n.last_author === 'user' ? ' · they wrote last' : ''))
        );
      }
      row.addEventListener('click', function () {
        handlers.onOpen(n.id);
      });
      list.appendChild(row);
    });
    root.appendChild(list);
  }

  function section(doc, parent, heading, text) {
    var s = el(doc, 'section', 'desk-section');
    s.appendChild(el(doc, 'h3', null, heading));
    if (text !== undefined) s.appendChild(el(doc, 'p', 'desk-words', text));
    parent.appendChild(s);
    return s;
  }

  function renderNote(doc, root, n, handlers) {
    clear(root);
    var back = el(doc, 'button', 'desk-link', '← All notes');
    back.setAttribute('type', 'button');
    back.addEventListener('click', handlers.onBack);
    root.appendChild(back);

    root.appendChild(el(doc, 'h2', null, kindLabel(n.kind)));
    root.appendChild(
      el(doc, 'p', 'desk-meta', statusLabel(n.status) + ' · ' + when(n.created_at) + (n.pinned ? ' · Waiting over 48 h' : ''))
    );
    if (n.chips && n.chips.length) root.appendChild(el(doc, 'p', 'desk-meta', 'Chips: ' + n.chips.join(', ')));
    if (n.target) root.appendChild(el(doc, 'p', 'desk-meta', 'About: ' + n.target + (n.target_id ? ' ' + n.target_id : '')));

    section(doc, root, 'Their words', n.words || '(no words, chips only)');
    if (n.dua_words) section(doc, root, 'Their du‘ā’s words', n.dua_words);

    if (n.diag && typeof n.diag === 'object') {
      var d = section(doc, root, 'Diagnostics');
      var dl = el(doc, 'dl', 'desk-diag');
      Object.keys(n.diag).forEach(function (k) {
        dl.appendChild(el(doc, 'dt', null, k));
        dl.appendChild(el(doc, 'dd', null, n.diag[k]));
      });
      d.appendChild(dl);
    }

    var shot = null;
    if (n.screenshot_path) {
      var s = section(doc, root, 'Screenshot');
      if (n.screenshot_expired) {
        s.appendChild(el(doc, 'p', 'desk-muted', 'Screenshot deleted (over 90 days old).'));
      } else {
        shot = { section: s };
      }
    }

    var thread = section(doc, root, 'Thread');
    if (!n.messages || !n.messages.length) thread.appendChild(el(doc, 'p', 'desk-muted', 'No messages yet.'));
    (n.messages || []).forEach(function (m) {
      var post = el(doc, 'div', 'desk-post desk-post-' + (m.author === 'founder' ? 'founder' : 'user'));
      post.appendChild(
        el(doc, 'p', 'desk-meta', (m.author === 'founder' ? (m.founder_name || 'Sakina') + ' · Sakina' : 'Them') + ' · ' + when(m.created_at))
      );
      post.appendChild(el(doc, 'p', 'desk-words', m.body));
      thread.appendChild(post);
    });

    var compose = section(doc, root, 'Reply');
    var box = el(doc, 'textarea', 'desk-input');
    box.setAttribute('rows', '4');
    box.setAttribute('maxlength', '2000');
    box.setAttribute('aria-label', 'Reply');
    compose.appendChild(box);
    var line = el(doc, 'p', 'desk-status');
    var send = el(doc, 'button', 'desk-button', 'Send reply');
    send.setAttribute('type', 'button');
    send.addEventListener('click', function () {
      var body = String(box.value || '').trim();
      if (!body) return;
      send.disabled = true;
      handlers.onReply(body).then(function (ok) {
        send.disabled = false;
        if (!ok) line.textContent = 'Could not send. Try again.';
      });
    });
    compose.appendChild(send);

    var actions = el(doc, 'div', 'desk-actions');
    [['looking', 'Mark looking'], ['fixed', 'Mark fixed']].forEach(function (pair) {
      var b = el(doc, 'button', 'desk-button desk-secondary', pair[1]);
      b.setAttribute('type', 'button');
      b.addEventListener('click', function () {
        b.disabled = true;
        handlers.onStatus(pair[0]).then(function (ok) {
          b.disabled = false;
          if (!ok) line.textContent = 'Could not change the status. Try again.';
        });
      });
      actions.appendChild(b);
    });
    compose.appendChild(actions);
    compose.appendChild(line);
    return shot;
  }

  // ── the page ──────────────────────────────────────────────────────────

  /**
   * env: { document, root, url, key, fetch, storage, hash, pageUrl,
   *        replaceHash(hash), now() → ms }.
   * Resolves once the first screen (and any note it opens) is drawn.
   */
  function start(env) {
    var doc = env.document;
    var root = env.root;
    var storage = env.storage;
    var session = null;

    function load() {
      try {
        var s = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
        return s && s.access_token ? s : null;
      } catch (_) {
        return null;
      }
    }
    function save(s) {
      session = s;
      if (s) storage.setItem(SESSION_KEY, JSON.stringify(s));
      else storage.removeItem(SESSION_KEY);
    }

    var api = createApi({
      url: env.url,
      key: env.key,
      fetch: env.fetch,
      token: function () {
        return session && session.access_token;
      }
    });

    var params = parseHash(env.hash);
    var nowSec = Math.floor(env.now() / 1000);
    if (params.access_token) {
      save({
        access_token: params.access_token,
        refresh_token: params.refresh_token || null,
        expires_at: params.expires_at ? Number(params.expires_at) : nowSec + Number(params.expires_in || 3600)
      });
      // The tokens never stay in the address bar (or in history).
      env.replaceHash('');
    } else {
      session = load();
    }
    if (params.note) storage.setItem(OPEN_NOTE_KEY, params.note);

    function signIn() {
      save(null);
      renderSignIn(doc, root, function (email) {
        return api.sendMagicLink(email, env.pageUrl).then(
          function () {},
          function () {}
        );
      });
      return Promise.resolve();
    }

    function fresh() {
      if (!session) return Promise.reject(failure('signed_out'));
      if (!session.expires_at || session.expires_at - 60 > Math.floor(env.now() / 1000)) return Promise.resolve();
      if (!session.refresh_token) return Promise.reject(failure('signed_out'));
      return api.refresh(session.refresh_token).then(function (b) {
        if (!b || !b.access_token) throw failure('signed_out');
        save({
          access_token: b.access_token,
          refresh_token: b.refresh_token || session.refresh_token,
          expires_at: b.expires_at || Math.floor(env.now() / 1000) + Number(b.expires_in || 3600)
        });
      });
    }

    function fail(e) {
      if (e && e.code === 'not_available') {
        renderNotAvailable(doc, root);
        return;
      }
      if (e && e.code === 'signed_out') {
        return signIn();
      }
      clear(root);
      root.appendChild(el(doc, 'p', 'desk-status', 'Something went wrong. Reload to try again.'));
    }

    function showList() {
      return fresh()
        .then(function () {
          return api.listFeedback(100);
        })
        .then(function (result) {
          renderList(doc, root, orderNotes(result), {
            onOpen: openNote,
            onSignOut: function () {
              signIn();
            }
          });
          var pending = storage.getItem(OPEN_NOTE_KEY);
          if (pending) {
            storage.removeItem(OPEN_NOTE_KEY);
            return openNote(pending);
          }
        })
        .catch(fail);
    }

    function openNote(noteId) {
      return fresh()
        .then(function () {
          return api.getFeedback(noteId);
        })
        .then(function (n) {
          var shot = renderNote(doc, root, n, {
            onBack: function () {
              showList();
            },
            onReply: function (body) {
              return api.reply(n.id, body).then(
                function () {
                  return openNote(n.id).then(function () {
                    return true;
                  });
                },
                function () {
                  return false;
                }
              );
            },
            onStatus: function (status) {
              return api.setStatus(n.id, status).then(
                function () {
                  return openNote(n.id).then(function () {
                    return true;
                  });
                },
                function () {
                  return false;
                }
              );
            }
          });
          if (!shot) return;
          return api.signScreenshot(n.screenshot_path).then(
            function (signed) {
              var img = el(doc, 'img', 'desk-shot');
              img.setAttribute('alt', 'Their screenshot');
              img.src = signed;
              shot.section.appendChild(img);
            },
            function () {
              shot.section.appendChild(el(doc, 'p', 'desk-muted', 'The screenshot could not be loaded.'));
            }
          );
        })
        .catch(fail);
    }

    if (!session) return signIn();
    return showList();
  }

  return {
    createApi: createApi,
    parseHash: parseHash,
    orderNotes: orderNotes,
    kindLabel: kindLabel,
    statusLabel: statusLabel,
    renderNote: renderNote,
    renderList: renderList,
    renderNotAvailable: renderNotAvailable,
    start: start
  };
});

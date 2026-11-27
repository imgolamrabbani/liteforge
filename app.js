(function () {
  const root = document.documentElement;
  const saved = localStorage.getItem('liteforge_theme');
  if (saved === 'light' || saved === 'dark') {
    root.setAttribute('data-theme', saved);
  }

  const toggleBtn = document.getElementById('theme-toggle');
  function syncLabel() {
    if (!toggleBtn) return;
    const current = root.getAttribute('data-theme') || 'dark';
    toggleBtn.textContent = current === 'light' ? 'Dark Mode' : 'Light Mode';
  }
  syncLabel();

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      localStorage.setItem('liteforge_theme', next);
      syncLabel();
    });
  }

  const snippets = {
    query: {
      code: `-- Pure WebAssembly SQLite (sql.js) · Zero Native Binaries
-- Safe on SQLite 3.41+ & Remote-SSH (no libtinfo.so.5 errors)

SELECT u.id, u.email, COUNT(o.id) AS order_count
  FROM "users" u
  LEFT JOIN "orders" o ON o.user_id = u.id
 GROUP BY u.id
 ORDER BY order_count DESC
 LIMIT 25;`,
      status: 'WASM Query: 1.4 ms · 25 rows returned'
    },
    edit: {
      code: `-- Pro: Transactional Inline Edit + SQL Diff Preview
BEGIN TRANSACTION;

UPDATE "users"
   SET "role" = 'admin'
 WHERE "rowid" = 2;

INSERT INTO "users" ("id", "email", "role")
VALUES ('usr_06', 'katherine@acme.dev', 'editor');

COMMIT; -- Atomic temp-file write-back`,
      status: '2 staged edits · Atomic write-back ready'
    },
    diff: {
      code: `-- Pro: 2-File SQLite Schema Diff (prod.sqlite -> staging.sqlite)
BEGIN TRANSACTION;

ALTER TABLE "users"
  ADD COLUMN "mfa_enabled" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "idx_orders_user_id"
  ON "orders" ("user_id");

COMMIT;`,
      status: '2 schema changes · Migration SQL generated'
    }
  };

  const tabs = document.querySelectorAll('[data-snippet]');
  const codeEl = document.getElementById('preview-code');
  const statusEl = document.getElementById('preview-status');

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      const item = snippets[tab.getAttribute('data-snippet')];
      if (item && codeEl && statusEl) {
        codeEl.textContent = item.code;
        statusEl.textContent = item.status;
      }
    });
  });
})();

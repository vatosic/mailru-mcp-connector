# Self-hosted deployment / Самостоятельная установка

These templates are optional, inactive examples. They do not provision a server,
DNS, TLS, OAuth, a tunnel, firewall changes or a hosted multi-user service.
Each owner supplies their own account, application password and trusted client.
Never reuse another person's mailbox, credentials or private tunnel association.

## Stdio first

Use the owner-managed setup in README. The MCP client owns the stdio process
lifecycle. If using SSH or a private tunnel, configure that transport separately
with strict server identity checks and access limited to the owner. Preserve
stdout for MCP only. A plain stdio process started by systemd without an attached
MCP client is not a useful remote service. No generic stdio bridge is shipped.

To use systemd LoadCredential with an independently configured private stdio
transport, `scripts/run-with-systemd-credential.py stdio` bridges the protected
systemd credential to an owner-only runtime file before launching src/index.js.
It requires CREDENTIALS_DIRECTORY/mailru-password, a private owner-writable
RUNTIME_DIRECTORY and an absolute NODE_BINARY pointing to Node24. Configure
MAILRU_USER, allowed folders and send opt-in yourself. The wrapper is not an
authentication mechanism; the transport must enforce owner-only access.

## Optional read-only HTTP on Linux

1. Review `deploy/http.env.example` and `deploy/mailru-mcp-http.service.example`.
   The unit is not installed or enabled by this repository. Use a dedicated
   nologin user, a root-owned read-only release under /opt/mailru-mcp, and install
   Node24 at the configured absolute path. Do not install under another service's
   user or reuse its secrets.
2. The owner stores their application password as a root-only 0600 credential
   outside git. With 2FA left enabled, use a trusted interactive terminal to
   run the password helper as the intended file owner; do not put the value in
   shell commands. For example, create /etc/mailru-mcp/credentials root0700,
   then run the helper via sudo with that directory's mailru-password path.
   No password goes to the developer.
3. Copy and edit the nonsecret HTTP env template, root-owned0600. Use your real
   issuer, HTTPS resource URL, same-origin JWKS URL and exact owner subject.
   Do not enable anonymous access or broaden the owner filter. Keep sending=false.
4. The service loads its credential through systemd. The wrapper creates a
   runtime0600 copy because LoadCredential files may use ACL-based permissions
   incompatible with the application's strict secret-file check. RuntimeDirectory
   is private and disappears on service stop. No secret is written into the release.
5. Validate the unit/configuration on your target system before enabling it.
   The HTTP listener binds 127.0.0.1 only; set up your own HTTPS reverse proxy and
   required authorization metadata routing. No nginx template or automatic public
   exposure is included. Respect host/origin checks; never disable certificate
   verification or publish an unauthenticated endpoint to make a test pass.
6. Verify that missing/invalid/wrong-owner tokens are rejected, then test
   tools/list with your client. HTTP exposes only the three read tools. A
   misconfigured issuer/JWKS/reverse proxy is a deployment failure, not a reason
   to remove authentication.

## Operational limits

The sample MemoryMax=384M is a starting bound, not a capacity guarantee. Validate
against your host and clients. Back up nonsecret config and protected state
separately from credentials; encrypt backups. Do not collect mail in diagnostic
logs. Only the selected owner may read state. Use the pinned lockfile and
`npm ci --ignore-scripts`; review dependency changes before upgrades.

Keep an old release and nonsecret configuration for rollback. Never roll back,
delete or recreate the send journal as part of an upgrade. Stop sending on
unknown outcomes; see SENDING.md. SMTP and IMAP credentials may have broader
provider rights than the application's tool surface.

## Русский

Базовый вариант — отдельный процесс stdio, которым управляет ваш MCP-клиент.
SSH/приватный туннель настраиваются вами отдельно с проверкой сервера и доступом
только владельца. Эта копия не создаёт общую публичную службу или аккаунты.

HTTP-шаблон предназначен только для чтения и требует собственного HTTPS и IdP.
Он не устанавливается автоматически. Пароль приложения владелец вводит скрыто
на своём сервере; 2FA не отключается. Секреты хранятся вне исходников, root0600,
и передаются через LoadCredential. Wrapper создаёт приватную временную копию
для приложения. SMTP через HTTP запрещён, поскольку mail:read не даёт права записи.

Перед включением проверьте unit, неправильные/чужие токены, личную область и
tools/list. Не отключайте авторизацию или TLS ради устранения ошибки. При
обновлении сохраните прежний релиз и журнал отправок; не смешивайте пользователей.

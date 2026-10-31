# Security policy / Политика безопасности

This independent project connects one owner's mailbox to that owner's MCP client.
It is not a hosted multi-user service, and it has no central account or telemetry.
No response-time or security-audit certification is promised. Only the current
reviewed release is intended to receive fixes; older versions should be upgraded
after checking changes and backing up persistent send state.

## Reporting a vulnerability

Use GitHub's **Security → Advisories → Report a vulnerability** when the repository
owner has enabled private vulnerability reporting. If that option is absent,
open an issue only asking for a private reporting channel; do not include exploit
details, passwords, tokens, mail, personal data, logs or production identifiers.
Use synthetic fixtures in a private report. Do not send your mailbox password
to a maintainer. The publication checklist requires enabling the private channel;
this document does not claim it has already been enabled.

## Deployment boundary

- One OS user/process/state directory per mailbox owner. No shared public endpoint.
- Keep 2FA enabled. The owner creates and enters a separate application password
  on their own trusted server or computer. This password is broader than read-only;
  read-only behavior is enforced by this application, not by Mail.ru credentials.
- Stdio has no network authentication layer: its client has the same mailbox
  capabilities as the process. Restrict who can start/connect to it. A private
  authenticated transport must remain owner-only; do not share tunnel keys.
- HTTP is opt-in and read-only only. It requires HTTPS outside the loopback
  listener plus externally issued JWTs bound to issuer, audience, owner and
  mail:read scope. HTTP+SMTP is rejected at startup. No authentication provider
  or public deployment is configured by this repository.
- Keep secret files outside the checkout, mode0600, in a private directory.
  MAILRU_APP_PASSWORD exists for managed environments, but file input is preferred.
  Environment values may be visible to privileged processes; do not put them in
  shell history, process arguments, CI secrets for untrusted PRs, or issues.
- Mail text and headers are untrusted. They may contain instructions, credentials
  or sensitive content. No automatic OTP/PII redaction is guaranteed. The selected
  content is sent to your MCP client and subject to that client's data policies.
- Require user confirmation of recipient and content before every send. Tool
  annotations are hints, not server-side evidence of consent. A compromised
  authorized client can send mail when sending is enabled.
- Preserve the send journal across restarts, upgrades and rollback. It contains
  hashes and Message-IDs, not bodies/passwords; treat it as private. Lost/corrupt
  journal means disable sending and reconcile before further operations. A new
  idempotency key can create a duplicate; SMTP has no exactly-once guarantee.
- TLS certificate verification stays enabled. Provider error details and mail
  contents must not be added to logs. Protect backups and revoke the application
  password if exposed. Review dependencies before upgrades.

## Русский

Сообщайте об уязвимостях через приватную форму GitHub, когда владелец её включит.
Если формы нет, попросите приватный канал без публикации деталей. Пароли,
настоящие письма, токены и журналы присылать нельзя. Примеры — синтетические.

Каждый пользователь самостоятельно запускает отдельный экземпляр на своём
сервере и вводит свой пароль приложения. 2FA не отключается. Разработчик не
получает доступ к ящику. Содержимое выбранных писем получает ваш MCP-клиент.
Отправка выключена по умолчанию; включайте её только с подтверждениями клиента.
Журнал отправок не удалять при обновлении/откате; unknown не означает, что письмо
не ушло. При компрометации отзовите пароль приложения и отключите отправку.

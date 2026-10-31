# Contributing / Участие

The project uses the [MIT license](LICENSE). Preserve copyright and license
notices. Dependencies retain their own licenses. There is no separate CLA flow;
no additional legal agreement is accepted by running the local tests.

Use synthetic fixtures only. Never commit passwords, OAuth keys, real addresses,
message bodies, message identifiers, provider logs, mailbox state, personal
tunnel/workspace IDs, host identities or private deployment notes. Dependencies
and local env/state are ignored; the ignore file does not replace review.

Run `npm ci --ignore-scripts --no-audit --no-fund` and `npm run check` on Node24.
For scripts, run `python3 -m unittest discover -s test -p '*_test.py'`.
Use offline transport fixtures; no real IMAP/SMTP in tests. Review failure,
timeout, duplicate-send and reply-target paths when touching sending. Preserve
fixed host/sender, TLS verification and EXAMINE/BODY.PEEK. Do not expose write
tools through the read-only HTTP authorization scope.

Before publication:

- Review every staged path and every historical blob; start with clean history.
- Scan secrets and personal identifiers, including generated output and commit
  metadata; do not publish scan reports that themselves contain private values.
- Exclude node_modules, credential/state directories, mail/log files and private
  operational scripts. Review lockfile changes and dependency licenses.
- Preserve the approved project's license and copyright attribution.
- Enable a private vulnerability-reporting channel and verify SECURITY.md.
- Do not add official logos, certification badges or promises of directory approval.
- Never test a write against a real mailbox without a separate exact instruction.

Русский: только синтетические данные, все тесты офлайн. Перед публикацией
проверьте файлы, git-историю и метаданные на секреты/личные данные. Сохраняйте
MIT-лицензию и уведомление об авторстве. Не публикуйте приватные отчёты,
рабочие настройки и журнал отправок. Не заявляйте официальное одобрение.

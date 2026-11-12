# Changelog

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování se řídí [Semantic Versioning](https://semver.org/lang/cs/).

Appka zatím nemá žádné vydání. Co před prvním veřejným vydáním chybí, vede
`docs/05-BACKLOG.md` v sekci „Před vydáním". Do vydání `1.0.0` se sem zapisují
jen změny, které se dotknou uživatele nebo formátu dat ve vaultu.

## [Nevydáno]

### Změněno

- Desktopová appka stojí na Electronu; ukládání do datové složky, PDF, ISDOC, Fio,
  ARES i most MCP běží v jejím hlavním procesu v TypeScriptu. Konektor MCP je
  táž appka spuštěná s `--mcp`, příkaz k registraci ukazuje stránka
  Integrace (viz `docs/06-MCP.md`).

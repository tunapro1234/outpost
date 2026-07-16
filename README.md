# Outpost

Graf-merkezli outreach aracı. Veri, Obsidian-uyumlu bir markdown vault'unda yaşar
(kişi / şirket / kurum / okul / kanal); Outpost bu vault'u parse edip ilişki grafını
merkeze koyan bir web arayüzü ve REST API sunar. Yanında, merkezi Playwright browser
sunucusuna bağlanan bir araştırma/scraping modülü gelir.

- **Tasarım:** `docs/DESIGN.md` · **Sözleşme:** `docs/SPEC.md` + `docs/SPEC-UI.md`
- **Çalıştırma:** `npm install && npm run build && OUTPOST_VAULT=./example-vault node server/index.mjs`
  → http://127.0.0.1:3002
- **İçe aktarma:** `node server/importer.mjs <kaynak-vault> <hedef-vault>`
- **Test:** `npm test`
- **Deploy:** `deploy/DEPLOY.md` (outpost.trasumanar.ai)

Kurallar: insan onayı olmadan mail gönderimi yok; login'li scraping ve kendi relay'den
SMTP probe yasak; secrets repoya girmez.

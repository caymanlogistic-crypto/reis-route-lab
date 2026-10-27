# Рейс: инструкции разработки

Русскоязычное приложение восстановления маршрутов. User facts must never silently change. Distinguish checkpoints, telemetry and reconstruction. Road routing may fail; never replace truck geometry with straight lines or a car route. Demo geometry is explicitly synthetic and usable only with the supplied demo points.

Architecture: pure ESM engine in src/engine.js, frontend in src/ui/, HTTP service src/service.js, Cloudflare Worker src/worker.js and local Node/SQLite adapter src/local.js. Durable hosted D1/R2; local data outside source. Immutable calculation snapshots, optimistic revisions, UTC throughout. Secrets excluded from source/logs/exports.

Parallel ownership: engine agent owns src/engine.js and tests/engine.test.js; UI agent owns src/ui/; export agent owns src/export.js, src/import.js and tests/exchange.test.js. Primary owns integration/server/build/docs and acceptance. Coordinate interfaces before changes.

Run npm test, npm run build; browser acceptance is required. Maintain README.md, docs/STATE.md, docs/DECISIONS.md with actual evidence and limitations. Never claim production ready while live routing or storage checks remain failed.

Обновление по прямому указанию пользователя: стандартная автомобильная маршрутизация mode=driving вместо truck. Масса, габариты, прицеп и грузовые ограничения в Router API больше не передаются. Режим явно обозначен в параметрах и снимке маршрута. Прямая проверка предоставленного ключа с mode=driving также вернула403 Invalid key.


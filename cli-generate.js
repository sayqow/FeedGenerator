
(async () => {
  try {
    const { generateMany } = require('./ymlGenerator');
    const base = process.env.BASE_URL || '';
    const res = await generateMany({ reqBase: base });
    for (const r of res) console.log('[OK]', r.file);
    process.exit(0);
  } catch (e) {
    console.error('[ERR]', e.message);
    process.exit(1);
  }
})();

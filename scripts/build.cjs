const { cpSync, mkdirSync } = require('node:fs');

mkdirSync('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'rules.js', 'app.js', 'assets']) {
  cpSync(path, 'dist/' + path, { recursive: true });
}

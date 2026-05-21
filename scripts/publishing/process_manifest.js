const fs = require('fs');
const path = require('path');

const manifestPath = path.join(process.cwd(), 'data', 'admin', 'content_manifest.json');
const now = new Date();
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let changed = false;

const updated = manifest.map(item => {
  if (item.status === 'approved' && item.validationPassed === true) {
    const publishAt = item.publishAt ? new Date(item.publishAt) : now;
    if (!Number.isNaN(publishAt.valueOf()) && publishAt <= now) {
      changed = true;
      const { previewPath, ...publishedItem } = item;
      return {
        ...publishedItem,
        status: 'published',
        publishedAt: now.toISOString()
      };
    }
  }
  return item;
});

if (changed) {
  fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2) + '\n');
  console.log('Manifest updated: approved items published.');
} else {
  console.log('Manifest unchanged.');
}

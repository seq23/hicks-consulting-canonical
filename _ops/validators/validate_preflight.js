const { exists, fail } = require('./util');
['package.json','README.md','robots.txt','sitemap.xml','llms.txt','pages','assets','data','scripts'].forEach(item => {
  if (!exists(item)) fail(`Missing required item: ${item}`);
});
console.log('Preflight OK');

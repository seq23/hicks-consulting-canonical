const { read, fail } = require('./util');
const robots = read('robots.txt');
if(!robots.includes('Sitemap: https://www.hicksconsulting.org/sitemap.xml')) fail('robots.txt missing sitemap');
console.log('Crawl contract OK');

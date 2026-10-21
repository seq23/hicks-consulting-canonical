const { fs, path, fail } = require('./util');
const routes = new Set();
function walk(dir, arr=[]){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e); const s=fs.statSync(p); if(s.isDirectory()) walk(p,arr); else if(e==='index.html') arr.push(p);} return arr; }
for(const file of walk(path.join(process.cwd(),'pages'))){ const rel='/' + path.relative(path.join(process.cwd(),'pages'), path.dirname(file)).replace(/\\/g,'/'); routes.add(rel==='/'?'/':rel+'/'); }
const allowedExternalPrefixes = [
  'https://www.hicksconsulting.org',
  'https://www.linkedin.com/',
  'https://www.instagram.com/',
  'https://www.facebook.com/',
  'https://www.psychologytoday.com/',
  'https://providers.therapyforblackgirls.com',
  'https://memphisvoyager.com/',
  'https://monika-hicks.clientsecure.me/',
  'https://www.apa.org/',
  'https://www.nimh.nih.gov/',
  'https://www.cdc.gov/',
  'https://www.samhsa.gov/',
  'https://github.com/',
  'https://dash.cloudflare.com/',
  'https://search.google.com/',
  'https://www.bing.com/webmasters/'
];
for(const file of walk(path.join(process.cwd(),'pages'))){
  const html=fs.readFileSync(file,'utf8');
  const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);
  for(const href of hrefs){
    if(href.startsWith('http')){
      if(!allowedExternalPrefixes.some(prefix => href.startsWith(prefix))) fail(`Unexpected external link ${href} in ${file}`);
    } else if(href.startsWith('/')) {
      if(href.startsWith('/assets/')|| href.startsWith('/data/')) continue;
      let normalized=href.endsWith('/')?href:href+'/';
      if(href==='/' ) normalized='/';
      if(!routes.has(normalized) && !['/assets/css/styles.css/','/assets/js/site.js/','/assets/js/admin.js/'].includes(normalized)) fail(`Broken internal route ${href} in ${file}`);
    }
  }
}

// Redirect targets (21 Oct 2026). Ahrefs reported "3XX redirect" and "HTTP to
// HTTPS redirect" URLs on the site. Every internal link, canonical, og:url and
// sitemap entry must name the final https://www 200 URL directly: no http://, no
// apex host, no directory route without its trailing slash (Pages answers those
// with a 308), no /index.html, and no path that _redirects sends elsewhere. The
// redirects themselves stay; nothing of ours may point at one.
const redirectSources = new Set(fs.readFileSync(path.join(process.cwd(), '_redirects'), 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]));
const redirectFindings = [];
let redirectTargetsChecked = 0;
function redirectProblem(url) {
  if (/^http:\/\/(www\.)?hicksconsulting\.org/i.test(url)) return 'http:// (redirects to https)';
  if (/^https?:\/\/hicksconsulting\.org/i.test(url)) return 'apex host (301s to www)';
  let p;
  if (/^https:\/\/www\.hicksconsulting\.org/i.test(url)) p = url.replace(/^https:\/\/www\.hicksconsulting\.org/i, '') || '/';
  else if (url.startsWith('/') && !url.startsWith('//')) p = url;
  else return null;
  p = p.split('#')[0].split('?')[0];
  if (!p) return null;
  if (redirectSources.has(p)) return `_redirects source (301s to its target)`;
  if (/\/index\.html$/.test(p)) return '/index.html (308s to the directory)';
  if (!p.endsWith('/') && routes.has(p + '/')) return 'route without trailing slash (308s to the slash form)';
  return null;
}
function checkTarget(url, where) {
  redirectTargetsChecked++;
  const problem = redirectProblem(url);
  if (problem) redirectFindings.push(`${where}: ${url} is a redirecting URL - ${problem}`);
}
for (const file of walk(path.join(process.cwd(), 'pages'))) {
  const html = fs.readFileSync(file, 'utf8');
  const where = path.relative(process.cwd(), file);
  // A page whose own route is a _redirects source is never served (the 301
  // answers first), so its own head tags are not links anyone can follow.
  const ownRoute = '/' + path.relative(path.join(process.cwd(), 'pages'), path.dirname(file)).replace(/\\/g, '/') + '/';
  if (redirectSources.has(ownRoute)) continue;
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) checkTarget(m[1], where);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) if (/rel="canonical"/i.test(m[0])) { const h = m[0].match(/href="([^"]+)"/); if (h) checkTarget(h[1], `${where} canonical`); }
  for (const m of html.matchAll(/<meta\b[^>]*property="og:url"[^>]*>/gi)) { const c = m[0].match(/content="([^"]+)"/); if (c) checkTarget(c[1], `${where} og:url`); }
}
for (const m of fs.readFileSync(path.join(process.cwd(), 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) checkTarget(m[1].trim(), 'sitemap.xml');
for (const m of fs.readFileSync(path.join(process.cwd(), 'robots.txt'), 'utf8').matchAll(/^\s*Sitemap:\s*(\S+)/gim)) checkTarget(m[1], 'robots.txt');
if (redirectTargetsChecked === 0) fail('Redirect-target check examined zero links - refusing to pass on an empty loop.');
if (redirectFindings.length) fail(['Internal links point at redirecting URLs:', ...redirectFindings.map((f) => `- ${f}`)]);
console.log(`Internal links OK (${redirectTargetsChecked} links, canonicals, og:urls and sitemap entries point at final URLs, none at a redirect).`);

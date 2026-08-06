import fs from 'node:fs';
import path from 'node:path';
import { ROOT, routeToSourceFile, writeTextAtomic } from './io.mjs';
import { normalizeContentType } from './cadence.mjs';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function paragraphize(value) {
  return String(value || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
}

function shell() {
  const template = path.join(ROOT, 'pages', 'resources', 'articles', 'why-high-achieving-women-sometimes-mistake-numbness-for-maturity', 'index.html');
  const html = fs.readFileSync(template, 'utf8');
  const header = html.match(/<header[\s\S]*?<\/header>/i)?.[0];
  const footer = html.match(/<footer[\s\S]*?<\/footer>/i)?.[0];
  if (!header || !footer) throw new Error('Unable to extract public site shell for autonomous resource rendering.');
  return { header, footer };
}

function typeLabel(type) {
  return ({ insights: 'Insights', articles: 'Articles', guides: 'Guides', 'white-papers': 'White Papers' })[type] || 'Resources';
}

export function renderResourceHtml({ draft, route, contentType, scheduledAt }) {
  const type = normalizeContentType(contentType);
  const label = typeLabel(type);
  const canonical = `https://www.hicksconsulting.org${route}`;
  const publishDate = new Date(scheduledAt).toISOString().slice(0, 10);
  const { header, footer } = shell();
  const sections = (draft.sections || []).map((section) => {
    const bullets = Array.isArray(section.bullets) && section.bullets.length ? `<ul class="resource-checklist">${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
    return `<section class="resource-section"><h2>${escapeHtml(section.heading)}</h2>${paragraphize(section.body)}${bullets}</section>`;
  }).join('');
  const links = (draft.internalLinks || []).filter((link) => /^\//.test(link)).map((link) => `<li><a href="${escapeHtml(link)}">${escapeHtml(link.replace(/^\/|\/$/g, '').replaceAll('-', ' ') || 'Hicks Consulting')}</a></li>`).join('');
  const sources = (draft.sources || []).filter((source) => /^https:\/\//i.test(typeof source === 'string' ? source : source?.url || '')).map((source) => {
    const url = typeof source === 'string' ? source : source.url;
    const title = typeof source === 'string' ? source : source.title || source.url;
    return `<li><a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(title)}</a></li>`;
  }).join('');
  const related = (links || sources) ? `<section class="resource-section"><h2>Related support and sources</h2>${links ? `<ul class="resource-links">${links}</ul>` : ''}${sources ? `<ul class="resource-links">${sources}</ul>` : ''}</section>` : '';
  const description = String(draft.description || draft.shortAnswer || '').slice(0, 165);
  const schema = {
    '@context': 'https://schema.org', '@type': 'Article', headline: draft.title, description,
    mainEntityOfPage: canonical, datePublished: publishDate, dateModified: publishDate,
    author: { '@type': 'Person', name: 'Monika Hicks, LCSW', url: 'https://www.hicksconsulting.org/about/' },
    publisher: { '@type': 'Organization', name: 'Hicks Consulting', url: 'https://www.hicksconsulting.org/', logo: { '@type': 'ImageObject', url: 'https://www.hicksconsulting.org/assets/hicks-consulting-logo-full.png' } },
    image: 'https://www.hicksconsulting.org/assets/hicks-consulting-logo-full.png'
  };
  const breadcrumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.hicksconsulting.org/' },
    { '@type': 'ListItem', position: 2, name: 'Resources', item: 'https://www.hicksconsulting.org/resources/' },
    { '@type': 'ListItem', position: 3, name: label, item: `https://www.hicksconsulting.org/resources/${type}/` },
    { '@type': 'ListItem', position: 4, name: draft.title, item: canonical }
  ] };
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"/><meta content="width=device-width, initial-scale=1" name="viewport"/><title>${escapeHtml(draft.title)} | Hicks Consulting</title><meta content="${escapeHtml(description)}" name="description"/><link href="${canonical}" rel="canonical"/><meta property="og:type" content="article"/><meta property="og:site_name" content="Hicks Consulting"/><meta property="og:title" content="${escapeHtml(draft.title)} | Hicks Consulting"/><meta property="og:description" content="${escapeHtml(description)}"/><meta property="og:url" content="${canonical}"/><meta property="og:image" content="https://www.hicksconsulting.org/assets/hicks-consulting-logo-full.png"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${escapeHtml(draft.title)} | Hicks Consulting"/><meta name="twitter:description" content="${escapeHtml(description)}"/><meta name="twitter:image" content="https://www.hicksconsulting.org/assets/hicks-consulting-logo-full.png"/><script type="application/ld+json">${JSON.stringify(breadcrumbs)}</script><script type="application/ld+json">${JSON.stringify(schema)}</script><script>try{var t=localStorage.getItem('hicks-theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}</script><link rel="icon" type="image/png" href="/assets/favicon.png"/><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"/><link href="/assets/css/styles.css" rel="stylesheet"/><script defer src="/assets/js/site.js"></script></head><body>${header}<main><section class="hero sub-hero"><div class="container narrow"><p class="eyebrow">${label}</p><h1>${escapeHtml(draft.title)}</h1><p class="resource-author-credit">Author: Monika Hicks, LCSW · <a href="/about/">Read bio</a> · <time datetime="${publishDate}">${new Date(`${publishDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time></p><div class="short-answer">${escapeHtml(draft.shortAnswer)}</div></div></section><section class="section"><div class="container narrow article-body">${sections}${related}<aside class="resource-author-box"><p class="eyebrow">About the author</p><h2><a href="/about/">Monika Hicks, LCSW</a></h2><p>Monika Hicks is a Black woman therapist, licensed clinical social worker, and founder of Hicks Consulting. She provides virtual therapy to eligible clients in Memphis and across Tennessee, along with coaching, groups, consulting, and organizational training.</p></aside><div class="notice"><strong>Informational note:</strong> ${escapeHtml(draft.disclaimer || 'This resource is educational and does not replace therapy, diagnosis, crisis care, or individualized medical advice.')}</div></div></section></main>${footer}</body></html>\n`;
}

export function writeResource({ draft, route, contentType, scheduledAt }) {
  const relative = routeToSourceFile(route);
  writeTextAtomic(relative, renderResourceHtml({ draft, route, contentType, scheduledAt }));
  return relative;
}

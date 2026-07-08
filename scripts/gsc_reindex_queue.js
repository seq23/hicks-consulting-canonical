#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const reportsDir = path.join(root, 'reports');
const priorityFile = path.join(reportsDir, 'indexnow-priority.txt');
const submitReportPath = path.join(reportsDir, 'indexnow-submit-report.json');
const priorityUrls = fs.existsSync(priorityFile)
  ? fs.readFileSync(priorityFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  : [];
const submitReport = fs.existsSync(submitReportPath) ? JSON.parse(fs.readFileSync(submitReportPath, 'utf8')) : null;
const queue = {
  repo: 'hicks-consulting-canonical',
  generatedAt: new Date().toISOString(),
  note: 'Google Search Console URL Inspection API can be used for status checks, but ordinary Request Indexing remains a manual GSC UI action. This queue identifies the small priority set to inspect/request manually after deploy.',
  gscSitemapSubmission: {
    recommended: true,
    sitemapUrl: 'https://www.hicksconsulting.org/sitemap.xml',
    automationStatus: 'not-configured-in-this-pass'
  },
  priorityUrls: priorityUrls.slice(0, 10).map(url => ({
    url,
    changedReason: 'priority public page included in current IndexNow priority set',
    indexNowSubmitted: Boolean(submitReport && submitReport.status === 'success'),
    indexNowStatus: submitReport?.status || 'unknown',
    gscSitemapSubmitted: false,
    urlInspectionStatus: 'unknown',
    manualRequestIndexingRecommended: true
  }))
};
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'search-reindex-queue.json'), JSON.stringify(queue, null, 2) + '\n');
console.log(`GSC reindex queue written: ${queue.priorityUrls.length} priority URLs`);

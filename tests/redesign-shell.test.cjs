'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');

test('redesigned navigation preserves all working destinations and real action handlers', () => {
  const html = read('index.html'), app=require('../lib/ui-bundle').assembleUiBundle();
  const keys=['dashboard','complaints','referrals','replies','notifications','reports','settings'];
  for(const key of keys){
    assert.match(html,new RegExp('data-page="'+key+'"'));
    assert.match(app,new RegExp('(?:^|[,\\{])'+key+'(?:[:,]|,)', 'm'));
  }
  for(const a of ['my-complaints','filter-missing','filter-late','new-complaint']){
    assert.ok(html.includes('data-action="'+a+'"'));
    assert.ok(app.includes("case '"+a+"'"));
  }
  for(const id of ['sidebar','menuToggle','content','pageCrumb','navComplaintsCount','navReferralsCount','navNotificationsCount','topUnread','modalRoot','sideUserName','topUserName','headerCreateButton']){
    assert.ok(html.includes('id="'+id+'"'),id+' missing');
  }
});
test('registration control is role-bound and not shown before login',()=>{
 const app=require('../lib/ui-bundle').assembleUiBundle(),html=read('index.html');
 assert.match(html, /id="headerCreateButton"[^>]*hidden/);
 assert.match(app, /headerCreate\.hidden=!authenticatedUser\|\|!\['admin','staff'\]\.includes\(role\)/);
 assert.match(app, /aria-current/);
});
test('new visual system is served locally and respects right-to-left and reduced motion',()=>{
 const css=read('redesign.css'),server=read('server.js'),sw=read('sw.js'),html=read('index.html');
 assert.match(html, /lang="ar" dir="rtl"/);
 assert.match(html, /href="redesign\.css"/);
 assert.match(server, /'\/redesign\.css': 'redesign\.css'/);
 assert.match(sw, /'\/redesign\.css'/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/html\[data-theme="dark"\]/);
 assert.match(css,/\.nav-group-label/);
 assert.doesNotMatch(css,/https?:\/\//);
});

test('mobile navigation closes from backdrop and Escape without changing complaint actions',()=>{
 const html=read('index.html'), js=read('ui-enhancements.js'), css=read('redesign.css');
 assert.match(html,/id="navBackdrop"/);
 assert.match(js,/function wireShell\(\)/);
 assert.match(js,/closeMenu\(true\)/);
 assert.match(js,/event\.key === 'Escape'/);
 assert.match(js,/document\.body\.dataset\.signedIn === 'true'/);
 assert.match(css,/\.sidebar\.open \+ \.nav-backdrop/);
});

test('navigation updates all items and complaint detail uses a full page, not a modal',()=>{
 const nav=read('ui/core/navigation.js'),page=read('ui/pages/detail.js');
 assert.ok(nav.includes("$$('.nav-link').forEach"));
 assert.match(nav,/complaintDetailPage/);
 assert.match(nav,/restoreUiRoute/);
 assert.match(page,/data-complaint-id/);
 assert.match(page,/complaint-page-tabs/);
 assert.match(page,/history\.pushState/);
 assert.doesNotMatch(page,/modal\('تفاصيل الشكوى'/);
});

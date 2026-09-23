#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const { patchSidebarSource } = require("./patch-sidebar-delete");

const SOURCE = [
  "function TrashInit(){return(TrashInit=once(()=>{TrashIcon=e=>(0,UI.jsx)(`svg`,{children:(0,UI.jsx)(`path`,{d:`M10.6299 1.33496 rest`})})}),TrashInit())}var TrashIcon",
  "function Rail(e){let t=Memo.c(18),{archive:n,primaryAction:r,getMenuItems:i,onBeforeOpen:a,onMenuOpenChange:o,pinAction:s}=e,c=intl();if(n==null&&r==null&&s==null&&i==null)return null;let l;l=[];let u;u=[{id:`thread-primary-action`,ariaLabel:c.formatMessage(Messages.archiveThread),icon:(0,UI.jsx)(Archive,{}),onClick:n}];let d;t[6]!==l||t[7]!==u?(d=[...l,...u],t[6]=l,t[7]=u,t[8]=d):d=t[8];let f;return(0,UI.jsx)(Actions,{actions:d,leadingAction:f,trailingAction:r})}",
  "function Row(){let t=Memo.c(20),E=true,yt=menu,bt=true,Et=+!!bt,xt=e=>{let{archive:t,primaryAction:r,onMenuOpenChange:i}=e;return(0,UI.jsx)(Rail,{primaryAction:r,archive:t,getMenuItems:E?()=>yt(`row-actions`):void 0,onMenuOpenChange:i,pinAction:void 0})};return(0,UI.jsx)(Item,{additionalHoverActionCount:Et,renderActions:xt})}",
  "function menu(){return[{id:`delete-thread`,message:{id:`sidebarElectron.deleteThread`},onSelect:openNativeDeleteDialog}]}",
].join(";");

test("adds only a hover action backed by the native delete item", () => {
  const first = patchSidebarSource(SOURCE);
  assert.equal(first.status, "patched");
  assert.match(
    first.code,
    /deleteAction:E\?\{message:null,onSelect:\(\)=>yt\(`row-actions`\)\.find\(e=>e\.id===`delete-thread`\)\?\.onSelect\(\)\}:void 0/,
  );
  assert.match(first.code, /Et=\(\+!!bt\)\+\(E\?1:0\)/);
  assert.doesNotMatch(first.code, /deleteAction:yt\(`row-actions`\)/);
  assert.doesNotMatch(first.code, /yt\(`row-actions`\)\.some/);
  assert.match(first.code, /onClick:CodexDeleteAction\.onSelect/);
  assert.match(first.code, /id:`thread-delete-action`/);
  assert.doesNotMatch(first.code, /delete-conversation|thread\/delete/);
  assert.equal(patchSidebarSource(first.code).status, "already");
});

test("migrates the render-time menu lookup from the previous patch", () => {
  const broken = patchSidebarSource(SOURCE).code
    .replace(
      "deleteAction:E?{message:null,onSelect:()=>yt(`row-actions`).find(e=>e.id===`delete-thread`)?.onSelect()}:void 0,",
      "deleteAction:yt(`row-actions`).find(e=>e.id===`delete-thread`),",
    )
    .replace("+(E?1:0)", "+(yt(`row-actions`).some(e=>e.id===`delete-thread`)?1:0)");
  const migrated = patchSidebarSource(broken);
  assert.equal(migrated.status, "patched");
  assert.doesNotMatch(migrated.code, /deleteAction:yt\(`row-actions`\)/);
  assert.doesNotMatch(migrated.code, /yt\(`row-actions`\)\.some/);
  assert.equal(patchSidebarSource(migrated.code).status, "already");
});

test("requires the official delete menu item", () => {
  assert.throws(
    () => patchSidebarSource(SOURCE.replace("id:`delete-thread`", "id:`archive-thread`")),
    /native delete-thread menu item is missing/,
  );
});

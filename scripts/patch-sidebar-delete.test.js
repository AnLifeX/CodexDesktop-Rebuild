#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { patchSidebarSource } = require("./patch-sidebar-delete");

const SOURCE = [
  "function TrashInit(){return(TrashInit=once(()=>{TrashIcon=e=>(0,UI.jsx)(`svg`,{children:(0,UI.jsx)(`path`,{d:`M10.6299 1.33496 rest`})})}),TrashInit())}var TrashIcon",
  "function Rail(e){let t=Memo.c(18),{archive:n,primaryAction:r,getMenuItems:i,onBeforeOpen:a,onMenuOpenChange:o,pinAction:s}=e,c=intl();if(n==null&&r==null&&s==null&&i==null)return null;let l;l=[];let u;u=[{id:`thread-primary-action`,ariaLabel:c.formatMessage(Messages.archiveThread),icon:(0,UI.jsx)(Archive,{}),onClick:n}];let d;t[6]!==l||t[7]!==u?(d=[...l,...u],t[6]=l,t[7]=u,t[8]=d):d=t[8];let f;return(0,UI.jsx)(Actions,{actions:d,leadingAction:f,trailingAction:r})}",
  "function Row(){let t=Memo.c(20),E=true,yt=menu,bt=true,Et=+!!bt,xt=e=>{let{archive:t,primaryAction:r,onMenuOpenChange:i}=e;return(0,UI.jsx)(Rail,{primaryAction:r,archive:t,getMenuItems:E?()=>yt(`row-actions`):void 0,onMenuOpenChange:i,pinAction:void 0})};return(0,UI.jsx)(Item,{additionalHoverActionCount:Et,renderActions:xt})}",
  "function menu(){return[{id:`delete-thread`,message:{id:`sidebarElectron.deleteThread`},onSelect:openNativeDeleteDialog}]}",
].join(";");

const NEW_SOURCE = [
  'function TrashInit(){return(TrashInit=once(()=>{TrashIcon=`<svg><path d="M10.6299 1.33496rest"/></svg>`}),TrashInit())}var TrashIcon',
  'function Rail(e){let{archive:n,awaitBeforeOpen:r,primaryAction:i,getMenuItems:a}=e,l=intl();if(n==null&&i==null&&a==null)return null;let u=[],d=[];let f;t[6]!==u||t[7]!==d?(f=[...u,...d],t[6]=u,t[7]=d,t[8]=f):f=t[8];let p;return(0,UI.jsx)(Actions,{actions:f,leadingAction:p,trailingAction:i,icon:(0,UI.jsx)(Icon,{}),id:`thread-primary-action`})}',
  'function Row(){let E=false,Re={disabled:false},Ct=menu,At=0,jt=null;let Tt=e=>{return(0,UI.jsx)(Rail,{getMenuItems:E||Re.disabled===!0?()=>Ct(`row-actions`):void 0,awaitBeforeOpen:void 0})};return(0,UI.jsx)(Item,{additionalHoverActionCount:At,renderActions:Tt})}',
  'function menu(){return[{id:`delete-thread`,onSelect:openNativeDeleteDialog}]}',
].join(';');

const SOURCE_1013 = NEW_SOURCE.replace(
  "archive:n,awaitBeforeOpen:r,",
  "archive:n,archiveAriaLabel:archiveLabel,awaitBeforeOpen:r,",
);

const SOURCE_1021 = SOURCE_1013
  .replace("Ct=menu", "K=Re.disabled===!0,Ct=menu")
  .replace("getMenuItems:E||Re.disabled===!0?", "getMenuItems:E||K?")
  .replace("awaitBeforeOpen:void 0", "onBeforeOpen:K?void 0:prepareMenu,retainArchiveAction:false");

test("adds only a hover action backed by the native delete item", () => {
  const first = patchSidebarSource(SOURCE);
  assert.equal(first.status, "patched");
  assert.match(
    first.code,
    /deleteAction:E\?\{message:null,onSelect:async\(\)=>\(await yt\(`row-actions`\)\)\.find\(e=>e\.id===`delete-thread`\)\?\.onSelect\(\)\}:void 0/,
  );
  assert.match(first.code, /Et=\(\+!!bt\)\+\(E\?1:0\)/);
  assert.doesNotMatch(first.code, /deleteAction:yt\(`row-actions`\)/);
  assert.doesNotMatch(first.code, /yt\(`row-actions`\)\.some/);
  assert.match(first.code, /onClick:CodexDeleteAction\.onSelect/);
  assert.match(first.code, /:c\.formatMessage\(CodexDeleteAction\.message\)/);
  assert.match(first.code, /id:`thread-delete-action`/);
  assert.doesNotMatch(first.code, /delete-conversation|thread\/delete/);
  assert.equal(patchSidebarSource(first.code).status, "already");
});

test("migrates the render-time menu lookup from the previous patch", () => {
  const broken = patchSidebarSource(SOURCE).code
    .replace(
      "deleteAction:E?{message:null,onSelect:async()=>(await yt(`row-actions`)).find(e=>e.id===`delete-thread`)?.onSelect()}:void 0,",
      "deleteAction:yt(`row-actions`).find(e=>e.id===`delete-thread`),",
    )
    .replace("+(E?1:0)", "+(yt(`row-actions`).some(e=>e.id===`delete-thread`)?1:0)");
  const migrated = patchSidebarSource(broken);
  assert.equal(migrated.status, "patched");
  assert.doesNotMatch(migrated.code, /deleteAction:yt\(`row-actions`\)/);
  assert.doesNotMatch(migrated.code, /yt\(`row-actions`\)\.some/);
  assert.equal(patchSidebarSource(migrated.code).status, "already");
});

test("repairs the hook function used as an intl value in an existing patch", () => {
  const broken = patchSidebarSource(SOURCE).code.replace(
    ":c.formatMessage(CodexDeleteAction.message)",
    ":intl.formatMessage(CodexDeleteAction.message)",
  );
  const repaired = patchSidebarSource(broken);
  assert.equal(repaired.status, "patched");
  assert.match(repaired.code, /:c\.formatMessage\(CodexDeleteAction\.message\)/);
  assert.equal(patchSidebarSource(repaired.code).status, "already");
});

test("requires the official delete menu item", () => {
  assert.throws(
    () => patchSidebarSource(SOURCE.replace("id:`delete-thread`", "id:`archive-thread`")),
    /native delete-thread menu item is missing/,
  );
});

test("click opens native confirmation with sync and async menus on both rails", async (t) => {
  for (const [rail, source] of [["legacy", SOURCE], ["new", NEW_SOURCE], ["26.1013", SOURCE_1013], ["26.1021", SOURCE_1021]]) {
    for (const asynchronous of [false, true]) await t.test(`${rail}, async=${asynchronous}`, async () => {
      const patched = patchSidebarSource(source).code;
      let confirmations = 0;
      const context = vm.createContext({
        Memo: { c: () => [] },
        t: [],
        once: fn => fn,
        intl: () => ({ formatMessage: message => message.id }),
        Messages: { archiveThread: { id: "archive" } },
        UI: { jsx: (component, props) => ({ component, props }) },
        Item: () => {},
        Actions: () => {},
        Archive: () => {},
        Icon: () => {},
        prepareMenu: () => {},
        openNativeDeleteDialog: () => { confirmations += 1; },
      });
      vm.runInContext(patched + `;var menuItems=[{id:\`delete-thread\`,onSelect:openNativeDeleteDialog}];menu=${asynchronous ? "async" : ""}()=>menuItems;`, context);
      const action = vm.runInContext("Rail(Row().props.renderActions({}).props).props.actions.find(action=>action.id===`thread-delete-action`)", context);
      assert.equal(action.ariaLabel, rail === "legacy" ? "Permanently delete" : "sidebarElectron.deleteThread");
      assert.equal(confirmations, 0, "rendering must not open confirmation");
      await action.onClick();
      assert.equal(confirmations, 1);
      vm.runInContext("menuItems=[]", context);
      await action.onClick();
      assert.equal(confirmations, 1, "missing native item must not delete an ineligible thread");
      if (rail === "26.1021") {
        for (const blocked of [source.replace("E=false", "E=true"), source.replace("disabled:false", "disabled:true")]) {
          vm.runInContext(patchSidebarSource(blocked).code, context);
          assert.equal(vm.runInContext("Rail(Row().props.renderActions({}).props).props.actions.some(action=>action.id===`thread-delete-action`)", context), false);
        }
      }
    });
  }
});

test("preserves the 26.1021 disabled and work-mode gates", () => {
  const patched = patchSidebarSource(SOURCE_1021);
  assert.match(patched.code, /deleteAction:!E&&!K\?/);
  assert.match(patched.code, /At=\(0\)\+\(!E&&!K\?1:0\)/);
  assert.ok(patched.code.includes("onBeforeOpen:K?void 0:prepareMenu,retainArchiveAction:false"));
  assert.equal(patchSidebarSource(patched.code).code, patched.code);
});

test("repairs the shipped synchronous callback on both rails and remains idempotent", () => {
  for (const source of [SOURCE, NEW_SOURCE]) {
    const broken = patchSidebarSource(source).code.replace(
      /onSelect:async\(\)=>\(await ([\w$]+)\(`row-actions`\)\)\.find/,
      "onSelect:()=>$1(`row-actions`).find",
    );
    const repaired = patchSidebarSource(broken);
    assert.equal(repaired.status, "patched");
    assert.match(repaired.code, /onSelect:async\(\)=>\(await [\w$]+\(`row-actions`\)\)\.find/);
    assert.equal(patchSidebarSource(repaired.code).status, "already");
  }
});

test("adds the hover action to the new sidebar rail with inline SVG icons", () => {
  const patched = patchSidebarSource(NEW_SOURCE);
  assert.equal(patched.status, "patched");
  assert.match(patched.code, /d:`M10\.6299 1\.33496rest`/);
  assert.match(patched.code, /\.find\(e=>e\.id===`delete-thread`\)\?\.onSelect\(\)/);
  assert.match(patched.code, /sidebarElectron\.deleteThread/);
  assert.match(patched.code, /ariaLabel:l\.formatMessage\(\{id:`sidebarElectron\.deleteThread`/);
  assert.equal(patchSidebarSource(patched.code).status, "already");
});

test("preserves the 26.1013 archive label and keeps the delete action idempotent", () => {
  const patched = patchSidebarSource(SOURCE_1013);
  assert.match(patched.code, /archive:n,deleteAction:CodexDeleteAction,archiveAriaLabel:archiveLabel,awaitBeforeOpen:r,/);
  assert.equal(patchSidebarSource(patched.code).code, patched.code);
  assert.throws(() => patchSidebarSource(SOURCE_1013.replace("archive:n,", "archive:n=null,")), /native sidebar action props changed/);
});

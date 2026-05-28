Total messages: 6 (Errors: 3, Warnings: 0)
Returning 3 messages for level "error"

[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://localhost:3001/favicon.ico:0
[ERROR] %o

%s TypeError: b.updatedAt.getTime is not a function
    at eval (webpack-internal:///(app-pages-browser)/./lib/console/view-models.ts:27:215)
    at Array.sort (<anonymous>)
    at buildConsoleTaskRows (webpack-internal:///(app-pages-browser)/./lib/console/view-models.ts:27:7)
    at ConsoleApp.useMemo[taskRows] (webpack-internal:///(app-pages-browser)/./components/console/console-app.tsx:56:123)
    at updateMemo (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:7887:19)
    at Object.useMemo (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:24153:18)
    at exports.useMemo (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react/cjs/react.development.js:1240:34)
    at ConsoleApp (webpack-internal:///(app-pages-browser)/./components/console/console-app.tsx:55:68)
    at Object.react_stack_bottom_frame (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:23584:20)
    at renderWithHooks (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:6793:22)
    at updateFunctionComponent (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:9247:19)
    at beginWork (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:10858:18)
    at runWithFiberInDEV (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:872:30)
    at performUnitOfWork (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:15727:22)
    at workLoopSync (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:15547:41)
    at renderRootSync (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:15527:11)
    at performWorkOnRoot (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:14991:13)
    at performSyncWorkOnRoot (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:16831:7)
    at flushSyncWorkAcrossRoots_impl (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:16677:21)
    at processRootScheduleInMicrotask (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:16715:9)
    at eval (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:16850:13) The above error occurred in the <ConsoleApp> component. It was handled by the <ErrorBoundaryHandler> error boundary. @ webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/client/react-client-callbacks/error-boundary-callbacks.js:67
Error: Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

- A server/client branch `if (typeof window !== 'undefined')`.
- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.
- Date formatting in a user's locale which doesn't match the server.
- External changing data without sending a snapshot of it along with the HTML.
- Invalid HTML tag nesting.

It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

https://react.dev/link/hydration-mismatch

  ...
    <RedirectBoundary>
      <RedirectErrorBoundary router={{...}}>
        <InnerLayoutRouter url="/" tree={[...]} cacheNode={{lazyData:null, ...}} segmentPath={[...]}>
          <SegmentViewNode type="page" pagePath="page.tsx">
            <SegmentTrieNode>
            <HomePage>
              <ConsoleApp initialData={{tasks:[...], ...}} view="tasks">
                <ConsoleShell active="tasks" summary={{runningCount:3, ...}} tasks={[...]} actions={[...]} agents={[...]} ...>
                  <div className="min-h-scre...">
                    <header className="sticky top...">
                      <div className="flex min-h...">
                        <div className="flex min-w...">
                          <div>
                          <div className="min-w-0">
                            <div>
                            <div className="flex min-w...">
                              <GitBranch>
                              <span>
                              <span>
+                               159859s
-                               159858s
                        ...
                      ...
                    ...
          ...
        ...

    at throwOnHydrationMismatch (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:4506:11)
    at completeWork (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:11825:26)
    at runWithFiberInDEV (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:872:30)
    at completeUnitOfWork (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:15863:19)
    at performUnitOfWork (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:15744:11)
    at workLoopConcurrentByScheduler (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:15721:9)
    at renderRootConcurrent (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:15696:15)
    at performWorkOnRoot (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:14990:13)
    at performWorkOnRootViaSchedulerTask (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js:16816:7)
    at MessagePort.performWorkUntilDeadline (webpack-internal:///(app-pages-browser)/../../node_modules/.pnpm/next@15.5.18_@babel+core@7.29.0_@playwright+test@1.59.1_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/next/dist/compiled/scheduler/cjs/scheduler.development.js:45:48)
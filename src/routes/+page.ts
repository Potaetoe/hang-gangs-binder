// The door is plain server-rendered HTML: native forms, a native
// disclosure, zero client JavaScript. With csr off there is no
// hydration, so nothing can replay initial state over a person's click
// or wipe what they typed - the bug class dies here rather than being
// patched around. The Telegram widget is an external script tag and
// unaffected.
export const csr = false;

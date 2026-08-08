/*
 * Browser half of the crypto checks. See crypto-browser-check.html for
 * how to run it.
 *
 * It reads the same dev/fixture.json the Node test reads rather than
 * carrying its own copy: two fixtures would be two things to keep in
 * step, and the one that drifted would be the one still passing.
 *
 * Deliberately not a copy of every case in crypto.test.mjs. The error
 * paths - a truncated row, a key for the wrong curve, a key file
 * contradicting itself - are plain JavaScript and behave identically
 * wherever they run; Node checks those once. What is worth repeating
 * here is everything that touches the platform: the policy, the secure
 * context, and the WebCrypto implementation itself.
 */
(async function () {
  const lines = [];
  let failures = 0;

  function say(ok, label, note) {
    if (!ok) failures++;
    lines.push((ok ? "pass  " : "FAIL  ") + label + (note ? "   " + note : ""));
  }

  async function check(label, fn) {
    try {
      const ok = (await fn()) === true;
      say(ok, label, ok ? "" : "returned false");
    } catch (error) {
      say(false, label, "threw: " + (error && error.message));
    }
  }

  async function mustReject(label, fn, fragment) {
    try {
      await fn();
      say(false, label, "did not throw");
    } catch (error) {
      const message = String(error && error.message);
      say(message.toLowerCase().includes(fragment), label,
        message.toLowerCase().includes(fragment) ? "" : "wrong error: " + message);
    }
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  try {
    const fixture = await (await fetch("fixture.json")).json();
    const keyFile = await (await fetch("test-key.json")).json();
    const fixture2 = await (await fetch("fixture-v2.json")).json();
    const memberKeyFile = await (await fetch("test-member-key.json")).json();

    // The platform, first - everything below is meaningless without it.
    await check("crypto.subtle available under the published CSP",
      async () => BinderCrypto.unavailableReason() === null &&
        window.isSecureContext === true);

    // The format, as already stored. This is the check with teeth: if
    // this browser cannot read what is in the database, the export tool
    // cannot either.
    await check("the version 1 fixture still decrypts here",
      async () => same(await BinderCrypto.decrypt(fixture.blob, keyFile),
        fixture.record));

    await check("its unicode survives this engine's encoder", async () => {
      const out = await BinderCrypto.decrypt(fixture.blob, keyFile);
      return out.note === fixture.record.note;
    });

    // The two-recipient format, in the same runtime. A member reads
    // their own history in a browser and the keyholder exports from
    // one, so both halves of the dual seal have to hold here, not only
    // in Node.
    await check("the version 2 fixture opens for the keyholder here",
      async () => same(await BinderCrypto.decrypt(fixture2.blob, keyFile),
        fixture2.record));

    await check("the same version 2 fixture opens for the member here",
      async () => same(await BinderCrypto.decrypt(fixture2.blob,
        memberKeyFile), fixture2.record));

    await check("this browser writes a row both recipients can open",
      async () => {
        const blob = await BinderCrypto.encryptTo(fixture.record,
          [keyFile.publicKey, memberKeyFile.publicKey]);
        return /^[A-Za-z0-9+/]+={0,2}$/.test(blob) &&
          blob.length < 16 * 1024 &&
          same(await BinderCrypto.decrypt(blob, keyFile), fixture.record) &&
          same(await BinderCrypto.decrypt(blob, memberKeyFile),
            fixture.record);
      });

    await mustReject("a third key opens no block of a version 2 row here",
      async () => {
        const pair = await crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
        return BinderCrypto.decrypt(fixture2.blob,
          await crypto.subtle.exportKey("jwk", pair.privateKey));
      },
      "recipient blocks");

    // A fresh submission, encrypted the way the form will encrypt it -
    // to the key this deployment actually publishes.
    await check("encrypts to config.js's key, base64 the Worker accepts",
      async () => {
        const blob = await BinderCrypto.encrypt(fixture.record,
          BINDER_CONFIG.publicKey);
        return /^[A-Za-z0-9+/]+={0,2}$/.test(blob) && blob.length < 16 * 1024;
      });

    await check("a fresh keypair round-trips in this browser", async () => {
      const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const raw = new Uint8Array(
        await crypto.subtle.exportKey("raw", pair.publicKey));
      let binary = "";
      for (const b of raw) binary += String.fromCharCode(b);
      const envelope = {
        curve: "P-256",
        publicKey: btoa(binary),
        privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
      };
      const blob = await BinderCrypto.encrypt(fixture.record, envelope.publicKey);
      return same(await BinderCrypto.decrypt(blob, envelope), fixture.record);
    });

    await check("this browser's randomness differs per submission",
      async () => {
        const a = await BinderCrypto.encrypt(fixture.record,
          BINDER_CONFIG.publicKey);
        const b = await BinderCrypto.encrypt(fixture.record,
          BINDER_CONFIG.publicKey);
        return a !== b;
      });

    await mustReject("an altered row is refused",
      () => BinderCrypto.decrypt(fixture.blob.slice(0, -6) + "AAAAAA", keyFile),
      "altered");

  } catch (error) {
    say(false, "the check itself failed", String(error && error.message) +
      " - is this served from the repository root?");
  }

  document.getElementById("out").textContent =
    lines.join("\n") + "\n\n" +
    (failures ? failures + " FAILURE(S)" : "all checks passed");
})();
